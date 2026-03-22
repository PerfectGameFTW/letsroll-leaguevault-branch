import { Client, Environment } from 'square';
import type { ApiError } from 'square';
import crypto from 'crypto';
import { storage } from '../storage';
import { createLogger } from '../logger';

const log = createLogger("SquareService");

interface SquareCustomer {
  id: string;
  name: string;
  email: string;
}

function buildSquareClient(accessToken: string, appId?: string): Client {
  const cleanToken = accessToken.replace(/[^\x20-\x7E]/g, '').trim();
  const isProductionAppId = appId ? (appId.length > 0 && !appId.includes('sandbox-')) : true;
  const isProductionToken = cleanToken.startsWith('EAAAEv') || cleanToken.startsWith('EAAAl7');
  const environment = (isProductionAppId || isProductionToken) ? Environment.Production : Environment.Sandbox;
  return new Client({ accessToken: cleanToken, environment });
}

/**
 * Returns a Square client for the given LeagueVault location ID.
 * Returns null if the location has no Square credentials configured.
 * Never falls back to global env-var credentials.
 */
export async function getSquareClientForLocation(lvLocationId: number): Promise<Client | null> {
  try {
    const creds = await storage.getLocationSquareConfig(lvLocationId);
    if (creds?.accessToken && creds.accessToken.trim().length > 0) {
      return buildSquareClient(creds.accessToken, creds.appId);
    }
    log.warn(`No Square credentials configured for location ${lvLocationId}`);
    return null;
  } catch (err) {
    log.warn(`Error fetching credentials for location ${lvLocationId}:`, err);
    return null;
  }
}

/**
 * Returns the Square Location ID for the given LeagueVault location.
 * Returns empty string when no location-specific ID is stored.
 */
export async function getSquareLocationId(lvLocationId: number): Promise<string> {
  try {
    const creds = await storage.getLocationSquareConfig(lvLocationId);
    if (creds?.locationId && creds.locationId.trim().length > 0) {
      return creds.locationId.trim();
    }
  } catch {
    // no-op
  }
  return '';
}

/**
 * Internal helper: resolves a Square Client from an optional LV location ID.
 * Returns null when locationId is absent or the location has no credentials.
 */
async function resolveSquareClient(locationId?: number | null): Promise<Client | null> {
  if (locationId != null) {
    return getSquareClientForLocation(locationId);
  }
  log.warn('resolveSquareClient called without locationId — no client available');
  return null;
}

export async function saveCardOnFile(sourceId: string, customerId: string, locationId?: number | null) {
  const client = await resolveSquareClient(locationId);
  if (!client) return null;

  try {
    log.info('Saving card on file for customer:', customerId.substring(0, 10) + '...');
    const response = await client.cardsApi.createCard({
      idempotencyKey: crypto.createHash('sha256').update(`card:${sourceId}:${customerId}`).digest('hex'),
      sourceId,
      card: {
        customerId,
      },
    });

    const card = response.result.card;
    if (card) {
      return {
        id: card.id,
        last4: card.last4,
        brand: card.cardBrand,
      };
    }
    return null;
  } catch (error) {
    log.error('Failed to save card on file:', error instanceof Error ? error.message : error);
    return null;
  }
}

export async function processPayment(sourceId: string, amount: number, storeCard: boolean = false, customerId?: string, buyerEmail?: string, idempotencyKey?: string, locationId?: number | null) {
  const client = await resolveSquareClient(locationId);
  if (!client) {
    throw new Error(JSON.stringify({
      error: {
        message: "Payment system is temporarily unavailable",
        code: "INITIALIZATION_ERROR"
      }
    }));
  }

  try {
    if (!sourceId || !amount) {
      throw new Error(JSON.stringify({
        error: {
          message: 'Missing required payment information',
          code: "INVALID_REQUEST"
        }
      }));
    }

    if (amount <= 0 || !Number.isInteger(amount)) {
      throw new Error(JSON.stringify({
        error: {
          message: 'Invalid payment amount',
          code: "INVALID_AMOUNT"
        }
      }));
    }

    const paymentRequest: any = {
      sourceId,
      idempotencyKey: idempotencyKey || `${Date.now()}-${Math.random()}`,
      amountMoney: {
        amount: BigInt(amount),
        currency: 'USD'
      },
      autocomplete: true
    };

    if (customerId) {
      paymentRequest.customerId = customerId;
    }

    if (buyerEmail) {
      paymentRequest.buyerEmailAddress = buyerEmail;
    }

    const response = await client.paymentsApi.createPayment(paymentRequest);

    if (!response?.result?.payment) {
      throw new Error(JSON.stringify({
        error: {
          message: 'Unable to process payment',
          code: "INVALID_RESPONSE"
        }
      }));
    }

    const payment = response.result.payment;
    const cardDetails = payment.cardDetails?.card;

    return {
      id: payment.id,
      status: payment.status,
      card: {
        last4: cardDetails?.last4 ?? '****',
        brand: cardDetails?.cardBrand ?? 'UNKNOWN'
      },
    };
  } catch (error) {
    if ((error as ApiError)?.statusCode === 400) {
      throw new Error(JSON.stringify({
        error: {
          message: 'Invalid payment information. Please check your card details.',
          code: "INVALID_REQUEST"
        }
      }));
    }

    if ((error as ApiError)?.statusCode === 401) {
      throw new Error(JSON.stringify({
        error: {
          message: 'Payment system is temporarily unavailable. Please try again later.',
          code: "SYSTEM_ERROR"
        }
      }));
    }

    if ((error as ApiError)?.statusCode === 402) {
      throw new Error(JSON.stringify({
        error: {
          message: 'Your payment was declined. Please try a different card.',
          code: "PAYMENT_DECLINED"
        }
      }));
    }

    throw new Error(JSON.stringify({
      error: {
        message: 'Unable to process your payment. Please try again later.',
        code: "PAYMENT_FAILED"
      }
    }));
  }
}

export async function createOrUpdateCustomer(name: string, email: string, phone?: string | null, locationId?: number | null): Promise<SquareCustomer | null> {
  const client = await resolveSquareClient(locationId);
  if (!client) {
    log.error('Square client not initialized');
    return null;
  }

  try {
    log.info('Searching for customer with email:', email);
    const searchResponse = await client.customersApi.searchCustomers({
      query: {
        filter: {
          emailAddress: {
            exact: email.toLowerCase()
          }
        }
      }
    });

    if (!searchResponse?.result) {
      throw new Error('API Error: Invalid search response');
    }

    let customerId: string;
    const [firstName, ...lastNameParts] = name.split(' ');
    const lastName = lastNameParts.join(' ');
    const phoneNumber = phone || undefined;

    if (searchResponse.result.customers?.[0]?.id) {
      log.info('Found existing customer, updating...');
      customerId = searchResponse.result.customers[0].id;
      const updateResponse = await client.customersApi.updateCustomer(customerId, {
        givenName: firstName,
        familyName: lastName || '',
        emailAddress: email.toLowerCase(),
        ...(phoneNumber && { phoneNumber }),
      });

      if (!updateResponse?.result?.customer) {
        throw new Error('API Error: Invalid update response');
      }

      log.info('Customer updated successfully:', updateResponse.result.customer.id);
    } else {
      log.info('No existing customer found, creating new...');
      const customerResponse = await client.customersApi.createCustomer({
        idempotencyKey: crypto.createHash('sha256').update(`customer:${email.toLowerCase()}:${name}`).digest('hex'),
        givenName: firstName,
        familyName: lastName || '',
        emailAddress: email.toLowerCase(),
        ...(phoneNumber && { phoneNumber }),
      });

      if (!customerResponse?.result?.customer?.id) {
        throw new Error('API Error: Invalid create response');
      }

      customerId = customerResponse.result.customer.id;
      log.info('New customer created successfully:', customerId);
    }

    return {
      id: customerId,
      name,
      email
    };
  } catch (error) {
    log.error('Customer operation error:', {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error,
      input: { name, email }
    });
    throw new Error('Failed to create/update Square customer: ' + (error instanceof Error ? error.message : String(error)));
  }
}

export async function listCatalogCategories(locationId?: number | null) {
  const client = locationId != null ? await getSquareClientForLocation(locationId) : null;
  if (!client) {
    return [];
  }

  try {
    const allObjects: any[] = [];
    let cursor: string | undefined;
    do {
      const response = await client.catalogApi.listCatalog(cursor, 'CATEGORY');
      const objects = response.result.objects || [];
      allObjects.push(...objects);
      cursor = response.result.cursor || undefined;
    } while (cursor);

    const seen = new Set<string>();
    const deduped = allObjects
      .filter((cat) => !cat.isDeleted)
      .map((cat) => ({
        id: cat.id,
        name: cat.categoryData?.name || 'Unnamed Category',
      }))
      .filter((cat) => {
        const key = cat.name.toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    log.info(`Categories: ${allObjects.length} raw -> ${deduped.length} deduped`);
    return deduped;
  } catch (error) {
    log.error('Catalog categories error:', error);
    throw new Error('Failed to fetch catalog categories: ' + (error instanceof Error ? error.message : String(error)));
  }
}

export async function listCatalogItems(categoryId?: string, locationId?: number | null) {
  const client = locationId != null ? await getSquareClientForLocation(locationId) : null;
  if (!client) {
    return [];
  }

  try {
    if (categoryId) {
      const response = await client.catalogApi.searchCatalogItems({
        categoryIds: [categoryId],
      });
      const items = response.result.items || [];

      return items.map((item) => {
        const variations = (item.itemData?.variations || []).map((v) => ({
          id: v.id,
          name: v.itemVariationData?.name || 'Default',
          price: v.itemVariationData?.priceMoney?.amount
            ? Number(v.itemVariationData.priceMoney.amount)
            : null,
          currency: v.itemVariationData?.priceMoney?.currency || 'USD',
        }));

        return {
          id: item.id,
          name: item.itemData?.name || 'Unnamed Item',
          description: item.itemData?.description || '',
          variations,
        };
      });
    }

    const response = await client.catalogApi.listCatalog(undefined, 'ITEM');
    const objects = response.result.objects || [];

    return objects.map((item) => {
      const variations = (item.itemData?.variations || []).map((v) => ({
        id: v.id,
        name: v.itemVariationData?.name || 'Default',
        price: v.itemVariationData?.priceMoney?.amount
          ? Number(v.itemVariationData.priceMoney.amount)
          : null,
        currency: v.itemVariationData?.priceMoney?.currency || 'USD',
      }));

      return {
        id: item.id,
        name: item.itemData?.name || 'Unnamed Item',
        description: item.itemData?.description || '',
        variations,
      };
    });
  } catch (error) {
    log.error('Catalog list error:', error);
    throw new Error('Failed to fetch catalog items: ' + (error instanceof Error ? error.message : String(error)));
  }
}

export interface OrderLineItem {
  catalogObjectId: string;
  quantity: string;
}

export async function createOrderWithPayment(
  sourceId: string,
  amount: number,
  lineItems: OrderLineItem[],
  lvLocationId?: number | null,
  storeCard: boolean = false,
  customerId?: string,
  buyerEmail?: string,
  idempotencyKey?: string,
) {
  const [client, squareLocationId] = await Promise.all([
    resolveSquareClient(lvLocationId),
    lvLocationId != null ? getSquareLocationId(lvLocationId) : Promise.resolve(''),
  ]);

  if (!client) {
    throw new Error(JSON.stringify({
      error: { message: "Payment system is temporarily unavailable", code: "INITIALIZATION_ERROR" }
    }));
  }

  if (!squareLocationId) {
    throw new Error(JSON.stringify({
      error: { message: "Square location not configured for this location", code: "CONFIGURATION_ERROR" }
    }));
  }

  try {
    const locationId = squareLocationId;
    const orderResponse = await client.ordersApi.createOrder({
      order: {
        locationId,
        lineItems,
      },
      idempotencyKey: idempotencyKey ? `${idempotencyKey}-order` : `order-${Date.now()}-${Math.random()}`,
    });

    const order = orderResponse.result.order;
    if (!order?.id) {
      throw new Error('Failed to create order');
    }

    log.info('Order created:', order.id);

    const paymentRequest: any = {
      sourceId,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}-pay` : `pay-${Date.now()}-${Math.random()}`,
      amountMoney: {
        amount: BigInt(amount),
        currency: 'USD',
      },
      orderId: order.id,
      locationId,
      autocomplete: true,
    };

    if (customerId) {
      paymentRequest.customerId = customerId;
    }

    if (buyerEmail) {
      paymentRequest.buyerEmailAddress = buyerEmail;
    }

    const paymentResponse = await client.paymentsApi.createPayment(paymentRequest);

    if (!paymentResponse?.result?.payment) {
      throw new Error(JSON.stringify({
        error: { message: 'Unable to process payment', code: "INVALID_RESPONSE" }
      }));
    }

    const payment = paymentResponse.result.payment;
    const cardDetails = payment.cardDetails?.card;

    return {
      id: payment.id,
      status: payment.status,
      orderId: order.id,
      card: {
        last4: cardDetails?.last4 ?? '****',
        brand: cardDetails?.cardBrand ?? 'UNKNOWN',
      },
    };
  } catch (error) {
    log.error('Order+Payment error:', error);
    if (error instanceof Error && error.message.startsWith('{')) {
      throw error;
    }
    const apiErr = error as ApiError;
    if (apiErr?.statusCode === 402) {
      throw new Error(JSON.stringify({
        error: { message: 'Your payment was declined. Please try a different card.', code: 'PAYMENT_DECLINED' }
      }));
    }
    if (apiErr?.statusCode === 400) {
      const result = apiErr?.result as { errors?: { detail?: string }[] } | undefined;
      const detail = result?.errors?.[0]?.detail;
      throw new Error(JSON.stringify({
        error: { message: 'Payment could not be processed. Please check your details and try again.', code: 'INVALID_REQUEST', detail }
      }));
    }
    throw new Error(JSON.stringify({
      error: { message: 'Payment processing failed. Please try again.', code: 'PAYMENT_FAILED' }
    }));
  }
}

export async function refundPayment(
  squarePaymentId: string,
  amountInCents: number,
  reason?: string,
  locationId?: number | null
): Promise<{ refundId: string; status: string }> {
  const client = await resolveSquareClient(locationId);
  if (!client) {
    throw new Error('Square client not initialized');
  }

  try {
    const idempotencyKey = `refund-${squarePaymentId}-${Date.now()}`;

    const response = await client.refundsApi.refundPayment({
      idempotencyKey,
      paymentId: squarePaymentId,
      amountMoney: {
        amount: BigInt(amountInCents),
        currency: 'USD',
      },
      reason: reason || 'Refund processed via LeagueVault',
    });

    const refund = response.result.refund;
    if (!refund || !refund.id) {
      throw new Error('Refund response missing refund data');
    }

    log.info(`Refund processed: ${refund.id}, status: ${refund.status}`);
    return {
      refundId: refund.id,
      status: refund.status || 'PENDING',
    };
  } catch (error) {
    log.error('Refund error:', error);
    const apiError = error as ApiError;
    if (apiError.errors) {
      const messages = apiError.errors.map((e: any) => e.detail).join(', ');
      throw new Error(`Square refund failed: ${messages}`);
    }
    throw error;
  }
}

export async function listCardsOnFile(customerId: string, locationId?: number | null): Promise<{ id: string; last4: string; brand: string; expMonth: number; expYear: number }[]> {
  const client = await resolveSquareClient(locationId);
  if (!client) return [];

  try {
    const response = await client.cardsApi.listCards(undefined, customerId);
    const cards = response.result.cards || [];
    return cards
      .filter(c => c.enabled)
      .map(c => ({
        id: c.id!,
        last4: c.last4 || '****',
        brand: c.cardBrand || 'UNKNOWN',
        expMonth: Number(c.expMonth) || 0,
        expYear: Number(c.expYear) || 0,
      }));
  } catch (error) {
    log.error('Failed to list cards on file:', error instanceof Error ? error.message : error);
    return [];
  }
}

export default {
  createOrUpdateCustomer,
  processPayment,
  saveCardOnFile,
  listCardsOnFile,
  listCatalogItems,
  listCatalogCategories,
  createOrderWithPayment,
  refundPayment,
};