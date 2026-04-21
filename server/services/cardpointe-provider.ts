import type {
  PaymentProvider,
  PaymentResult,
  RefundResult,
  SavedCard,
  PaymentCustomer,
  PaymentVerification,
  OrderLineItem,
} from './payment-provider';
import {
  authorizeTransaction,
  voidTransaction,
  refundTransaction,
  createOrUpdateProfile,
  getProfile,
  deleteProfile,
  inquireTransaction,
  formatAmountForCardPointe,
  parseCardPointeAmount,
  mapCardBrand,
  extractLast4,
  detectBrandFromToken,
  type CardPointeCredentials,
} from './cardpointe';
import { storage } from '../storage';
import { createLogger } from '../logger';

const log = createLogger('CardPointeProvider');

export class CardPointePaymentProvider implements PaymentProvider {
  readonly providerName = 'cardpointe';
  private readonly locationId: number;

  constructor(locationId: number) {
    this.locationId = locationId;
  }

  private async getCredentials(): Promise<CardPointeCredentials> {
    const creds = await storage.getLocationCardPointeConfig(this.locationId);
    if (!creds?.merchantId || !creds?.apiUsername || !creds?.apiPassword || !creds?.siteUrl) {
      throw new Error(JSON.stringify({
        error: {
          message: 'CardPointe is not configured for this location',
          code: 'CONFIGURATION_ERROR',
        },
      }));
    }
    return {
      merchantId: creds.merchantId,
      apiUsername: creds.apiUsername,
      apiPassword: creds.apiPassword,
      siteUrl: creds.siteUrl,
    };
  }

  async processPayment(
    sourceId: string,
    amount: number,
    _storeCard?: boolean,
    _customerId?: string,
    buyerEmail?: string,
    _idempotencyKey?: string,
  ): Promise<PaymentResult> {
    const creds = await this.getCredentials();

    const authParams: Parameters<typeof authorizeTransaction>[1] = {
      account: sourceId,
      amount: formatAmountForCardPointe(amount),
      capture: 'Y',
      email: buyerEmail,
      ..._idempotencyKey !== undefined && { orderid: _idempotencyKey },
    };

    if (sourceId.includes('/')) {
      const [profileId, acctId] = sourceId.split('/');
      authParams.profile = `${profileId}/${acctId}`;
      authParams.account = acctId;
    }

    const result = await authorizeTransaction(creds, authParams);

    return {
      id: result.retref,
      status: 'COMPLETED',
      card: {
        last4: extractLast4(result.account),
        brand: mapCardBrand(result.acctid ? undefined : detectBrandFromToken(result.token || result.account)),
      },
      providerRef: {
        cardpointeRetref: result.retref,
        cardpointeAuthcode: result.authcode,
      },
    };
  }

  async createOrderWithPayment(
    sourceId: string,
    amount: number,
    _lineItems: OrderLineItem[],
    _storeCard?: boolean,
    _customerId?: string,
    buyerEmail?: string,
    _idempotencyKey?: string,
  ): Promise<PaymentResult> {
    return this.processPayment(sourceId, amount, false, undefined, buyerEmail, _idempotencyKey);
  }

  async refundPayment(
    paymentId: string,
    amountInCents: number,
    _reason?: string,
  ): Promise<RefundResult> {
    const creds = await this.getCredentials();

    try {
      const inquiry = await inquireTransaction(creds, paymentId);
      const isSettled = inquiry.setlstat === 'Y';

      if (isSettled) {
        const result = await refundTransaction(
          creds,
          paymentId,
          formatAmountForCardPointe(amountInCents),
        );
        return { refundId: result.retref, status: 'REFUNDED' };
      } else {
        const result = await voidTransaction(
          creds,
          paymentId,
          formatAmountForCardPointe(amountInCents),
        );
        return { refundId: result.retref, status: 'VOIDED' };
      }
    } catch (error) {
      log.error('CardPointe refund/void failed, attempting refund as fallback', {
        retref: paymentId,
        error: error instanceof Error ? error.message : String(error),
      });
      const result = await refundTransaction(
        creds,
        paymentId,
        formatAmountForCardPointe(amountInCents),
      );
      return { refundId: result.retref, status: 'REFUNDED' };
    }
  }

  async saveCardOnFile(
    sourceId: string,
    _customerId: string,
  ): Promise<SavedCard | null> {
    const creds = await this.getCredentials();

    const profileResult = await createOrUpdateProfile(creds, {
      account: sourceId,
      defaultacct: 'Y',
    });

    if (!profileResult.profileid || !profileResult.acctid) {
      log.error('CardPointe profile creation returned no profileid/acctid');
      return null;
    }

    const cardId = `${profileResult.profileid}/${profileResult.acctid}`;
    return {
      id: cardId,
      last4: extractLast4(profileResult.token || sourceId),
      brand: mapCardBrand(profileResult.accttype),
    };
  }

  async listCardsOnFile(
    customerId: string,
  ): Promise<SavedCard[]> {
    const creds = await this.getCredentials();

    const profileId = customerId.includes('/') ? customerId.split('/')[0] : customerId;

    try {
      const profiles = await getProfile(creds, profileId);
      return profiles
        .filter(p => p.respstat === 'A' && p.profileid)
        .map(p => ({
          id: `${p.profileid}/${p.acctid}`,
          last4: extractLast4(p.token || ''),
          brand: mapCardBrand(p.accttype),
        }));
    } catch (error) {
      log.warn('Failed to list CardPointe profiles', {
        profileId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async disableCard(
    cardId: string,
    _customerId: string,
  ): Promise<void> {
    const creds = await this.getCredentials();
    const [profileId, accountId] = cardId.includes('/') ? cardId.split('/') : [cardId, undefined];
    await deleteProfile(creds, profileId, accountId);
  }

  async createOrUpdateCustomer(
    _name: string,
    _email: string,
    _phone?: string | null,
  ): Promise<PaymentCustomer | null> {
    log.info(
      'CardPointe does not support standalone customer creation — a card token is required to create a profile. Returning null.',
    );
    return null;
  }

  /**
   * Delete the entire CardPointe profile (and all of its accounts) for
   * the supplied profileId. Used by the automated account-data deletion
   * flow. CardPointe stores customers as "profiles" — passing only the
   * profileId (no accountId) tells the API to delete the whole profile.
   */
  async deleteCustomer(customerId: string): Promise<void> {
    const creds = await this.getCredentials();
    const [profileId] = customerId.includes('/') ? customerId.split('/') : [customerId];
    try {
      await deleteProfile(creds, profileId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // CardPointe returns an error for unknown profiles; treat as
      // already-gone so this stays idempotent.
      if (/not found|invalid profile/i.test(msg)) {
        log.info('CardPointe profile already absent, treating as deleted', { profileId });
        return;
      }
      throw error;
    }
  }

  async getPayment(
    paymentId: string,
  ): Promise<PaymentVerification | null> {
    const creds = await this.getCredentials();

    try {
      const inquiry = await inquireTransaction(creds, paymentId);

      let timestamp = new Date().toISOString();
      const localPayment =
        await storage.getPaymentByCardpointeRetref(paymentId) ??
        await storage.getPaymentByProviderPaymentId(paymentId);
      if (localPayment?.createdAt) {
        timestamp = localPayment.createdAt;
      } else {
        log.warn('No local payment record found for CardPointe retref, using current time as fallback', {
          retref: paymentId,
        });
      }

      return {
        id: inquiry.retref,
        status: inquiry.respstat === 'A' ? 'COMPLETED' : 'FAILED',
        amountMoney: {
          amount: String(parseCardPointeAmount(inquiry.amount)),
          currency: 'USD',
        },
        createdAt: timestamp,
        updatedAt: timestamp,
        sourceType: 'CARD',
        last4: extractLast4(inquiry.account),
      };
    } catch (error) {
      log.error('Failed to inquire CardPointe transaction', {
        retref: paymentId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  validateCardId(cardId: string | null): boolean {
    if (!cardId) return false;
    return /^\d+\/\d{1,2}$/.test(cardId) || /^\d{10,}$/.test(cardId);
  }
}
