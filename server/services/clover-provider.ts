import type {
  PaymentProvider,
  PaymentResult,
  RefundResult,
  SavedCard,
  PaymentCustomer,
  PaymentVerification,
  OrderLineItem,
  CustomerCleanupProvider,
} from './payment-provider';
import {
  createCharge,
  getCharge,
  createRefund,
  createCustomer,
  getCustomer,
  deleteCustomer as deleteCloverCustomer,
  createCustomerSource,
  listCustomerSources,
  deleteCustomerSource,
  mapCloverBrand,
  CloverApiError,
  type CloverCredentials,
} from './clover';
import { storage } from '../storage';
import { createLogger } from '../logger';
import {
  ProviderNotConfiguredError,
  PaymentProviderError,
  CardOwnershipMismatchError,
} from './payment-provider-factory';

const log = createLogger('CloverProvider');

export class CloverPaymentProvider implements PaymentProvider, CustomerCleanupProvider {
  readonly providerName = 'clover';
  readonly locationId: number;

  constructor(locationId: number) {
    this.locationId = locationId;
  }

  private async getCredentials(): Promise<CloverCredentials> {
    const creds = await storage.getLocationCloverConfig(this.locationId);
    if (!creds?.apiToken || !creds.apiToken.trim() || !creds.merchantId || !creds.merchantId.trim()) {
      throw new ProviderNotConfiguredError(
        'Clover is not configured for this location',
        this.locationId,
      );
    }
    return {
      apiToken: creds.apiToken.trim(),
      merchantId: creds.merchantId.trim(),
      environment: creds.environment ?? 'sandbox',
    };
  }

  private mapApiError(err: unknown, fallbackMessage: string, fallbackCode: string): never {
    if (err instanceof PaymentProviderError || err instanceof ProviderNotConfiguredError) {
      throw err;
    }
    if (err instanceof CloverApiError) {
      const detail = typeof err.body === 'string' ? err.body : err.message;
      if (err.status === 401 || err.status === 403) {
        throw new PaymentProviderError(
          'Payment system is temporarily unavailable. Please try again later.',
          'SYSTEM_ERROR',
          detail,
        );
      }
      if (err.status === 402) {
        throw new PaymentProviderError(
          'Your payment was declined. Please try a different card.',
          'PAYMENT_DECLINED',
          detail,
        );
      }
      if (err.status >= 400 && err.status < 500) {
        throw new PaymentProviderError(
          'Invalid payment information. Please check your card details.',
          'INVALID_REQUEST',
          detail,
        );
      }
      throw new PaymentProviderError(fallbackMessage, fallbackCode, detail);
    }
    throw new PaymentProviderError(
      fallbackMessage,
      fallbackCode,
      err instanceof Error ? err.message : String(err),
    );
  }

  async processPayment(
    sourceId: string,
    amount: number,
    _storeCard?: boolean,
    customerId?: string,
    buyerEmail?: string,
    idempotencyKey?: string,
  ): Promise<PaymentResult> {
    const creds = await this.getCredentials();

    if (!sourceId || !amount) {
      throw new PaymentProviderError(
        'Missing required payment information',
        'INVALID_REQUEST',
      );
    }
    if (amount <= 0 || !Number.isInteger(amount)) {
      throw new PaymentProviderError('Invalid payment amount', 'INVALID_AMOUNT');
    }

    try {
      const charge = await createCharge(creds, {
        amount,
        source: sourceId,
        customer: customerId,
        receiptEmail: buyerEmail,
        externalReferenceId: idempotencyKey,
      });
      return {
        id: charge.id,
        status: charge.status || 'COMPLETED',
        card: {
          last4: charge.source?.last4 ?? '****',
          brand: mapCloverBrand(charge.source?.brand),
        },
        providerRef: { cloverChargeId: charge.id },
      };
    } catch (error) {
      this.mapApiError(
        error,
        'Unable to process your payment. Please try again later.',
        'PAYMENT_FAILED',
      );
    }
  }

  async createOrderWithPayment(
    sourceId: string,
    amount: number,
    _lineItems: OrderLineItem[],
    storeCard?: boolean,
    customerId?: string,
    buyerEmail?: string,
    idempotencyKey?: string,
  ): Promise<PaymentResult> {
    // Clover Ecommerce charges already carry the line-item context via
    // `description`/`external_reference_id`; there is no separate
    // "create order, then create payment" round-trip on this API.
    return this.processPayment(sourceId, amount, storeCard, customerId, buyerEmail, idempotencyKey);
  }

  async refundPayment(
    paymentId: string,
    amountInCents: number,
    reason?: string,
  ): Promise<RefundResult> {
    const creds = await this.getCredentials();
    try {
      const refund = await createRefund(creds, {
        charge: paymentId,
        amount: amountInCents,
        reason,
      });
      return {
        refundId: refund.id,
        status: refund.status || 'REFUNDED',
      };
    } catch (error) {
      this.mapApiError(error, 'Refund could not be processed.', 'REFUND_FAILED');
    }
  }

  async saveCardOnFile(sourceId: string, customerId: string): Promise<SavedCard | null> {
    if (!customerId) {
      log.warn('saveCardOnFile called without a Clover customer id — returning null');
      return null;
    }
    const creds = await this.getCredentials();
    try {
      const source = await createCustomerSource(creds, customerId, sourceId);
      if (!source.id) return null;
      return {
        id: source.id,
        last4: source.last4 ?? '****',
        brand: mapCloverBrand(source.brand),
        expMonth: source.exp_month,
        expYear: source.exp_year,
      };
    } catch (error) {
      log.error('Failed to save card on file:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  async listCardsOnFile(customerId: string): Promise<SavedCard[]> {
    if (!customerId) return [];
    const creds = await this.getCredentials();
    try {
      const sources = await listCustomerSources(creds, customerId);
      return sources
        .filter((s) => s.id)
        .map((s) => ({
          id: s.id,
          last4: s.last4 ?? '****',
          brand: mapCloverBrand(s.brand),
          expMonth: s.exp_month,
          expYear: s.exp_year,
        }));
    } catch (error) {
      log.error('Failed to list cards on file:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  async disableCard(cardId: string, customerId: string): Promise<void> {
    if (!customerId) {
      throw new PaymentProviderError(
        'Cannot remove card without a customer id',
        'INVALID_REQUEST',
      );
    }
    const creds = await this.getCredentials();

    // Tenancy pre-check (task #649) — list this customer's saved
    // sources first and throw the typed `CardOwnershipMismatchError`
    // if `cardId` isn't among them. This brings Clover to parity with
    // Square's `disableCard` (task #620): the DELETE
    // /api/payments-provider/cards/:bowlerId/:cardId route matches
    // the typed class on `instanceof` and returns a dedicated 403.
    // Without this pre-check, the same caller bug on a Clover
    // location surfaced as a generic Clover not-found mapped to a
    // 500 PaymentProviderError, giving admins a different and less
    // actionable response shape than Square locations.
    let sources;
    try {
      sources = await listCustomerSources(creds, customerId);
    } catch (error) {
      this.mapApiError(error, 'Failed to remove card.', 'CARD_REMOVAL_FAILED');
    }
    const cardBelongsToCustomer = sources.some((s) => s.id === cardId);
    if (!cardBelongsToCustomer) {
      throw new CardOwnershipMismatchError();
    }

    try {
      await deleteCustomerSource(creds, customerId, cardId);
    } catch (error) {
      this.mapApiError(error, 'Failed to remove card.', 'CARD_REMOVAL_FAILED');
    }
  }

  async createOrUpdateCustomer(
    name: string,
    email: string,
    phone?: string | null,
    referenceId?: string | null,
  ): Promise<PaymentCustomer | null> {
    const creds = await this.getCredentials();
    const [firstName, ...rest] = name.split(' ');
    const lastName = rest.join(' ');
    try {
      const customer = await createCustomer(creds, {
        email: email.toLowerCase(),
        firstName,
        lastName: lastName || undefined,
        phoneNumber: phone || undefined,
        externalReferenceId:
          referenceId && referenceId.trim().length > 0 ? referenceId.trim() : undefined,
      });
      if (!customer?.id) return null;
      return { id: customer.id, name, email };
    } catch (error) {
      log.error('Customer create/update error:', {
        error: error instanceof Error ? { name: error.name, message: error.message } : error,
        input: { name, email },
      });
      throw new Error(
        'Failed to create/update Clover customer: ' +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  async deleteCustomer(customerId: string): Promise<void> {
    const creds = await this.getCredentials();
    try {
      await deleteCloverCustomer(creds, customerId);
    } catch (error) {
      this.mapApiError(error, 'Failed to delete Clover customer.', 'CUSTOMER_DELETE_FAILED');
    }
  }

  async getPayment(paymentId: string): Promise<PaymentVerification | null> {
    const creds = await this.getCredentials();
    try {
      const charge = await getCharge(creds, paymentId);
      const created = charge.created
        ? new Date(charge.created * 1000).toISOString()
        : new Date().toISOString();
      return {
        id: charge.id,
        status: charge.status || 'COMPLETED',
        amountMoney: { amount: String(charge.amount), currency: (charge.currency || 'usd').toUpperCase() },
        createdAt: created,
        updatedAt: created,
        sourceType: 'CARD',
        cardBrand: mapCloverBrand(charge.source?.brand),
        last4: charge.source?.last4,
      };
    } catch (error) {
      if (error instanceof CloverApiError && error.status === 404) {
        return null;
      }
      log.error('Failed to verify Clover charge:', {
        chargeId: paymentId,
        error: error instanceof Error ? error.message : error,
      });
      return null;
    }
  }

  /**
   * Clover Ecommerce vault card-token shape:
   *   - One-time card tokens minted by the iframe SDK begin with `clv_`.
   *   - Vaulted source ids saved on a customer begin with `src_` (or
   *     similar opaque ids returned by `POST /v1/customers/{id}/sources`).
   *
   * Returning `true` means "this id is a vaulted/saved-card reference"
   * — used by callers to decide whether to attempt a save-on-file
   * round-trip again. Anything that doesn't match the saved-source
   * shape (i.e. one-time tokens) returns false so the save attempt
   * still runs.
   */
  validateCardId(cardId: string | null): boolean {
    if (!cardId) return false;
    return /^src_/.test(cardId);
  }
}
