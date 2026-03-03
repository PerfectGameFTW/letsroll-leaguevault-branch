import { Client, Environment } from 'square';
import type { ApiError } from 'square';

interface SquareCustomer {
  id: string;
  name: string;
  email: string;
}

let squareClient: Client | null = null;

async function initializeSquareClient() {
  const accessToken = (process.env.SQUARE_PROD_TOKEN || process.env.SQUARE_PRODUCTION_ACCESS_TOKEN || process.env.SQUARE_ACCESS_TOKEN || '').replace(/[^\x20-\x7E]/g, '').trim();
  if (!squareClient && accessToken) {
    try {
      console.log('[Square Service] Initializing Square client...');
      console.log('[Square Service] Environment:', process.env.NODE_ENV);
      console.log('[Square Service] Token source:', process.env.SQUARE_PROD_TOKEN ? 'SQUARE_PROD_TOKEN' : process.env.SQUARE_PRODUCTION_ACCESS_TOKEN ? 'SQUARE_PRODUCTION_ACCESS_TOKEN' : 'SQUARE_ACCESS_TOKEN');

      const isProductionToken = accessToken.startsWith('EAAAEv') || accessToken.startsWith('EAAAl7');
      
      const prodAppId = process.env.SQUARE_PRODUCTION_APP_ID || '';
      const viteAppId = process.env.VITE_SQUARE_APP_ID || '';
      const sqAppId = process.env.SQUARE_APP_ID || '';
      const appId = prodAppId
        || ((viteAppId && !viteAppId.includes('sandbox-')) ? viteAppId : '')
        || ((sqAppId && !sqAppId.includes('sandbox-')) ? sqAppId : '')
        || viteAppId || sqAppId;
      const isProductionAppId = appId.length > 0 && !appId.includes('sandbox-');
      
      const environment = isProductionAppId ? Environment.Production : Environment.Sandbox;
      
      console.log('[Square Service] Token format:', isProductionToken ? 'PRODUCTION' : 'SANDBOX');
      console.log('[Square Service] App ID format:', isProductionAppId ? 'PRODUCTION' : 'SANDBOX');
      console.log('[Square Service] Using Square environment:', environment === Environment.Production ? 'Production' : 'Sandbox');
      squareClient = new Client({
        accessToken,
        environment
      });

      console.log('[Square Service] Square client initialized successfully');
      console.log('[Square Service] Using environment:', environment === Environment.Production ? 'Production' : 'Sandbox');
    } catch (error) {
      console.error('[Square Service] Failed to initialize Square client:', error);
      throw new Error('Failed to initialize Square client: ' + (error instanceof Error ? error.message : String(error)));
    }
  }
  return squareClient;
}

export async function saveCardOnFile(sourceId: string, customerId: string) {
  const client = await initializeSquareClient();
  if (!client) return null;

  try {
    console.log('[Square Service] Saving card on file for customer:', customerId.substring(0, 10) + '...');
    const response = await client.cardsApi.createCard({
      idempotencyKey: `card-${Date.now()}-${Math.random()}`,
      sourceId,
      card: {
        customerId,
      },
    });

    const card = response.result.card;
    if (card) {
      console.log('[Square Service] Card saved on file:', {
        cardId: card.id ? card.id.substring(0, 15) + '...' : 'unknown',
        last4: card.last4 || '****',
        brand: card.cardBrand || 'UNKNOWN',
      });
      return {
        id: card.id,
        last4: card.last4,
        brand: card.cardBrand,
      };
    }
    return null;
  } catch (error) {
    console.error('[Square Service] Failed to save card on file:', error instanceof Error ? error.message : error);
    return null;
  }
}

export async function processPayment(sourceId: string, amount: number, storeCard: boolean = false, customerId?: string, buyerEmail?: string) {
  const client = await initializeSquareClient();
  if (!client) {
    throw new Error(JSON.stringify({
      error: {
        message: "Payment system is temporarily unavailable",
        code: "INITIALIZATION_ERROR"
      }
    }));
  }

  try {
    console.log('[Square Service] Processing payment:', { 
      amount,
      sourceIdPrefix: sourceId.substring(0, 5),
      mode: process.env.NODE_ENV === 'production' ? 'Production' : 'Sandbox',
      storeCard,
      hasCustomerId: !!customerId
    });

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
      idempotencyKey: `${Date.now()}-${Math.random()}`,
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

    console.log('[Square Service] Payment processed successfully:', {
      paymentId: payment.id,
      status: payment.status,
      cardLast4: cardDetails?.last4 ?? '****',
      cardBrand: cardDetails?.cardBrand ?? 'UNKNOWN',
      amount: payment.amountMoney?.amount?.toString(),
    });

    return {
      id: payment.id,
      status: payment.status,
      card: {
        last4: cardDetails?.last4 ?? '****',
        brand: cardDetails?.cardBrand ?? 'UNKNOWN'
      },
    };
  } catch (error) {
    console.error('[Square Service] Payment processing error:', {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error,
      input: { 
        amount,
        sourceIdPresent: !!sourceId,
        storeCard
      }
    });

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

export async function createOrUpdateCustomer(name: string, email: string, phone?: string | null): Promise<SquareCustomer | null> {
  const client = await initializeSquareClient();
  if (!client) {
    console.error('[Square Service] Square client not initialized');
    return null;
  }

  try {
    console.log('[Square Service] Searching for customer with email:', email);
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
      console.log('[Square Service] Found existing customer, updating...');
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

      console.log('[Square Service] Customer updated successfully:', updateResponse.result.customer.id);
    } else {
      console.log('[Square Service] No existing customer found, creating new...');
      const customerResponse = await client.customersApi.createCustomer({
        idempotencyKey: `${Date.now()}-${Math.random()}`,
        givenName: firstName,
        familyName: lastName || '',
        emailAddress: email.toLowerCase(),
        ...(phoneNumber && { phoneNumber }),
      });

      if (!customerResponse?.result?.customer?.id) {
        throw new Error('API Error: Invalid create response');
      }

      customerId = customerResponse.result.customer.id;
      console.log('[Square Service] New customer created successfully:', customerId);
    }

    return {
      id: customerId,
      name,
      email
    };
  } catch (error) {
    console.error('[Square Service] Customer operation error:', {
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

export async function listCatalogCategories() {
  const client = await initializeSquareClient();
  if (!client) {
    throw new Error('Square client not initialized');
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
    console.log(`[Square Service] Categories: ${allObjects.length} raw -> ${deduped.length} deduped`);
    return deduped;
  } catch (error) {
    console.error('[Square Service] Catalog categories error:', error);
    throw new Error('Failed to fetch catalog categories: ' + (error instanceof Error ? error.message : String(error)));
  }
}

export async function listCatalogItems(categoryId?: string) {
  const client = await initializeSquareClient();
  if (!client) {
    throw new Error('Square client not initialized');
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
    console.error('[Square Service] Catalog list error:', error);
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
  locationId: string,
  storeCard: boolean = false,
  customerId?: string,
  buyerEmail?: string
) {
  const client = await initializeSquareClient();
  if (!client) {
    throw new Error(JSON.stringify({
      error: { message: "Payment system is temporarily unavailable", code: "INITIALIZATION_ERROR" }
    }));
  }

  try {
    console.log('[Square Service] Creating order with catalog items:', {
      amount,
      lineItemCount: lineItems.length,
      locationId,
      sourceIdPrefix: sourceId.substring(0, 5),
      storeCard,
      hasCustomerId: !!customerId,
    });

    const orderResponse = await client.ordersApi.createOrder({
      order: {
        locationId,
        lineItems,
      },
      idempotencyKey: `order-${Date.now()}-${Math.random()}`,
    });

    const order = orderResponse.result.order;
    if (!order?.id) {
      throw new Error('Failed to create order');
    }

    console.log('[Square Service] Order created:', order.id);

    const paymentRequest: any = {
      sourceId,
      idempotencyKey: `pay-${Date.now()}-${Math.random()}`,
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
    console.error('[Square Service] Order+Payment error:', error);
    throw error;
  }
}

export default {
  createOrUpdateCustomer,
  processPayment,
  saveCardOnFile,
  listCatalogItems,
  listCatalogCategories,
  createOrderWithPayment,
};