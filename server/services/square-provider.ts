import { Client, Environment } from 'square';
import type { ApiError, CreatePaymentRequest, CatalogObject } from 'square';
import crypto from 'crypto';
import { storage } from '../storage';
import { createLogger } from '../logger';
import { isDev } from '../config';
import { ProviderNotConfiguredError } from './payment-provider-factory';
import type {
  PaymentProvider,
  CatalogProvider,
  WalletProvider,
  PaymentResult,
  RefundResult,
  SavedCard,
  PaymentCustomer,
  PaymentVerification,
  OrderLineItem,
  CatalogCategory,
  CatalogItem,
} from './payment-provider';

const log = createLogger("SquareService");

function buildSquareClient(accessToken: string, appId?: string): Client {
  const cleanToken = accessToken.replace(/[^\x20-\x7E]/g, '').trim();
  const isProductionAppId = appId ? (appId.length > 0 && !appId.includes('sandbox-')) : true;
  const isProductionToken = cleanToken.startsWith('EAAAEv') || cleanToken.startsWith('EAAAl7');
  const environment = (isProductionAppId || isProductionToken) ? Environment.Production : Environment.Sandbox;
  return new Client({ accessToken: cleanToken, environment });
}

export class SquarePaymentProvider implements PaymentProvider, CatalogProvider, WalletProvider {
  readonly providerName = 'square';
  private readonly locationId: number;

  constructor(locationId: number) {
    this.locationId = locationId;
  }

  private async getSquareClient(): Promise<Client | null> {
    try {
      const creds = await storage.getLocationSquareConfig(this.locationId);
      if (creds?.accessToken && creds.accessToken.trim().length > 0) {
        return buildSquareClient(creds.accessToken, creds.appId);
      }
      log.warn(`No Square credentials configured for location ${this.locationId}`);
      return null;
    } catch (err) {
      log.warn(`Error fetching credentials for location ${this.locationId}:`, err);
      return null;
    }
  }

  private async getSquareLocationId(): Promise<string> {
    try {
      const creds = await storage.getLocationSquareConfig(this.locationId);
      if (creds?.locationId && creds.locationId.trim().length > 0) {
        return creds.locationId.trim();
      }
    } catch {
      // no-op
    }
    return '';
  }

  async processPayment(
    sourceId: string,
    amount: number,
    storeCard?: boolean,
    customerId?: string,
    buyerEmail?: string,
    idempotencyKey?: string,
  ): Promise<PaymentResult> {
    const client = await this.getSquareClient();
    if (!client) {
      // Surface the structured "not configured" signal so the
      // /api/payments-provider/payments route maps it to 422
      // PROVIDER_NOT_CONFIGURED instead of 500. See task #332.
      throw new ProviderNotConfiguredError(
        'Square client not configured for this location',
        this.locationId,
      );
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

      const paymentRequest: CreatePaymentRequest = {
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

  async createOrderWithPayment(
    sourceId: string,
    amount: number,
    lineItems: OrderLineItem[],
    storeCard?: boolean,
    customerId?: string,
    buyerEmail?: string,
    idempotencyKey?: string,
  ): Promise<PaymentResult> {
    const [client, squareLocationId] = await Promise.all([
      this.getSquareClient(),
      this.getSquareLocationId(),
    ]);

    if (!client) {
      // Same structured "not configured" contract as processPayment.
      throw new ProviderNotConfiguredError(
        'Square client not configured for this location',
        this.locationId,
      );
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

      const paymentRequest: CreatePaymentRequest = {
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

  async refundPayment(
    paymentId: string,
    amountInCents: number,
    reason?: string,
  ): Promise<RefundResult> {
    const client = await this.getSquareClient();
    if (!client) {
      // /api/payments/:id/refund maps this to 422 PROVIDER_NOT_CONFIGURED
      // so admins can tell "Square isn't connected for this location"
      // apart from "Square rejected the refund". See task #332.
      throw new ProviderNotConfiguredError(
        'Square client not configured for this location',
        this.locationId,
      );
    }

    try {
      const idempotencyKey = `refund-${paymentId}-${Date.now()}`;

      const response = await client.refundsApi.refundPayment({
        idempotencyKey,
        paymentId,
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
        const messages = apiError.errors
          .map((e: { detail?: string }) => e.detail)
          .join(', ');
        throw new Error(`Square refund failed: ${messages}`);
      }
      throw error;
    }
  }

  async saveCardOnFile(
    sourceId: string,
    customerId: string,
  ): Promise<SavedCard | null> {
    const client = await this.getSquareClient();
    if (!client) {
      // Throw the structured "not configured" error so the
      // POST /cards/:bowlerId route surfaces 422
      // PROVIDER_NOT_CONFIGURED. The opportunistic save-card
      // call inside POST /payments wraps this in a try/catch
      // that just logs, so it stays non-fatal there. Task #332.
      throw new ProviderNotConfiguredError(
        'Square client not configured for this location',
        this.locationId,
      );
    }

    try {
      if (isDev) log.info('Saving card on file for customer:', customerId.substring(0, 10) + '...');
      const response = await client.cardsApi.createCard({
        idempotencyKey: crypto.createHash('sha256').update(`card:${sourceId}:${customerId}`).digest('hex'),
        sourceId,
        card: {
          customerId,
        },
      });

      const card = response.result.card;
      if (card?.id) {
        return { id: card.id, last4: card.last4 ?? '', brand: card.cardBrand ?? '' };
      }
      return null;
    } catch (error) {
      log.error('Failed to save card on file:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  async listCardsOnFile(
    customerId: string,
  ): Promise<SavedCard[]> {
    const client = await this.getSquareClient();
    if (!client) {
      // Intentionally degraded: GET /cards/:bowlerId is a read
      // path that already treats "no provider configured" as
      // "no saved cards" and returns []. Throwing here would
      // turn a benign empty list into a 500 in the route's
      // outer catch. Task #332 — kept silent on purpose.
      return [];
    }

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

  async disableCard(
    cardId: string,
    customerId: string,
  ): Promise<void> {
    const client = await this.getSquareClient();
    if (!client) {
      // DELETE /cards/:bowlerId/:cardId maps PNCE → 422
      // PROVIDER_NOT_CONFIGURED. Task #332.
      throw new ProviderNotConfiguredError(
        'Square client not configured for this location',
        this.locationId,
      );
    }

    const listResponse = await client.cardsApi.listCards(undefined, customerId);
    const cards = listResponse.result.cards || [];
    const cardBelongsToCustomer = cards.some(c => c.id === cardId);
    if (!cardBelongsToCustomer) {
      throw new Error('Card does not belong to this customer');
    }

    await client.cardsApi.disableCard(cardId);
  }

  async createOrUpdateCustomer(
    name: string,
    email: string,
    phone?: string | null,
  ): Promise<PaymentCustomer | null> {
    const client = await this.getSquareClient();
    if (!client) {
      // POST /customers, the bowler-update sync, the bowler-create
      // sync, and the user-update sync all already catch
      // ProviderNotConfiguredError — the route maps it to 422 and
      // the background syncs log it and continue. Returning null
      // here used to leak as a generic 500 from the customers
      // route. Task #332.
      throw new ProviderNotConfiguredError(
        'Square client not configured for this location',
        this.locationId,
      );
    }

    try {
      if (isDev) log.info('Searching for customer with email:', email);
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
        if (isDev) log.info('Found existing customer, updating...');
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

        if (isDev) log.info('Customer updated successfully:', updateResponse.result.customer.id);
      } else {
        if (isDev) log.info('No existing customer found, creating new...');
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
        if (isDev) log.info('New customer created successfully:', customerId);
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

  /**
   * Delete a Square customer record. Used by the automated account-data
   * deletion flow. Square responds with NOT_FOUND for unknown customers;
   * we swallow that to keep this idempotent.
   */
  async deleteCustomer(customerId: string): Promise<void> {
    const client = await this.getSquareClient();
    if (!client) {
      // Account-deletion explicitly catches PNCE and records
      // `error: '<message>'` on the per-target audit summary so
      // operators can see "Square wasn't connected for that
      // location" rather than a vague provider failure.
      // Task #332.
      throw new ProviderNotConfiguredError(
        'Square client not configured for this location',
        this.locationId,
      );
    }
    try {
      await client.customersApi.deleteCustomer(customerId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/NOT_FOUND|not found/i.test(msg)) {
        if (isDev) log.info('Square customer already absent, treating as deleted', { customerId });
        return;
      }
      throw error;
    }
  }

  async getPayment(
    paymentId: string,
  ): Promise<PaymentVerification | null> {
    const client = await this.getSquareClient();
    if (!client) {
      // Intentionally degraded: GET /payments/:id/verify is a
      // diagnostic read used by the admin reconciliation UI. It
      // wraps the call in a try/catch that already turns PNCE
      // (from the factory) and any thrown verification error
      // into a "providerPayment: null" response. Returning null
      // here keeps that contract stable. Task #332.
      log.warn('Cannot verify payment — no Square client for location:', this.locationId);
      return null;
    }

    try {
      const response = await client.paymentsApi.getPayment(paymentId);
      const payment = response.result.payment;
      if (!payment) return null;

      return {
        id: payment.id!,
        status: payment.status || 'UNKNOWN',
        amountMoney: {
          amount: String(payment.amountMoney?.amount ?? 0),
          currency: payment.amountMoney?.currency || 'USD',
        },
        createdAt: payment.createdAt || '',
        updatedAt: payment.updatedAt || '',
        sourceType: payment.sourceType || 'UNKNOWN',
        cardBrand: payment.cardDetails?.card?.cardBrand,
        last4: payment.cardDetails?.card?.last4,
        orderId: payment.orderId,
      };
    } catch (error) {
      log.error('Failed to retrieve Square payment:', paymentId, error instanceof Error ? error.message : error);
      return null;
    }
  }

  validateCardId(cardId: string | null): boolean {
    if (!cardId) return false;
    return cardId.startsWith('ccof:');
  }

  async listCatalogCategories(): Promise<CatalogCategory[]> {
    const client = await this.getSquareClient();
    if (!client) {
      // Intentionally degraded: GET /catalog/categories already
      // converts a factory-level PNCE into an empty list (the
      // admin UI shows a "no catalog yet" empty state in that
      // case). Throwing here would turn that into a 500 inside
      // the route's outer catch. Task #332.
      return [];
    }

    try {
      const allObjects: CatalogObject[] = [];
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
      if (isDev) log.info(`Categories: ${allObjects.length} raw -> ${deduped.length} deduped`);
      return deduped;
    } catch (error) {
      log.error('Catalog categories error:', error);
      throw new Error('Failed to fetch catalog categories: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  async listCatalogItems(categoryId?: string): Promise<CatalogItem[]> {
    const client = await this.getSquareClient();
    if (!client) {
      // Intentionally degraded: same contract as
      // listCatalogCategories above. Task #332.
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

  async registerApplePayDomain(domain: string): Promise<{ success: boolean; message: string }> {
    const client = await this.getSquareClient();
    if (!client) {
      // Throw the structured "not configured" error so callers (the
      // sync register-domain route, the async Apple Pay worker, and
      // the org auto-registration helper) can distinguish "the
      // provider isn't set up at all" from "Square accepted the
      // request and rejected the domain". The route maps this to 422
      // PROVIDER_NOT_CONFIGURED; the worker/helper already log it.
      throw new ProviderNotConfiguredError(
        'Square client not configured for this location',
        this.locationId,
      );
    }

    try {
      await client.applePayApi.registerDomain({ domainName: domain });
      log.info(`Apple Pay domain registered: ${domain}`);
      return { success: true, message: `Domain ${domain} registered for Apple Pay` };
    } catch (error) {
      // Square's `ApiError` exposes the parsed body via a `result` field that
      // isn't on the SDK type. Narrow to a structural type instead of casting
      // through `any`, so we can still safely read `result.errors[0].detail`.
      type SquareApiErrorWithResult = ApiError & {
        result?: { errors?: Array<{ detail?: string }> };
      };
      const apiError = error as SquareApiErrorWithResult;
      const detail = apiError?.result?.errors?.[0]?.detail;
      log.error('Apple Pay domain registration error:', detail || error);
      return { success: false, message: detail || 'Failed to register domain for Apple Pay' };
    }
  }
}
