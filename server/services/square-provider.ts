import { SquareClient, SquareEnvironment, SquareError } from 'square';
import type { CreatePaymentRequest, CatalogObject } from 'square';
import crypto from 'crypto';
import { storage } from '../storage';
import { createLogger } from '../logger';
import { isDev } from '../config';
import { ProviderNotConfiguredError, PaymentProviderError } from './payment-provider-factory';
import {
  ensureDefinitions,
  upsertCustomerStringAttribute,
  LEAGUE_NAME_KEY,
  LEAGUE_SEASON_KEY,
} from './square-custom-attributes';
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

function buildSquareClient(accessToken: string, appId?: string): SquareClient {
  const cleanToken = accessToken.replace(/[^\x20-\x7E]/g, '').trim();
  const isProductionAppId = appId ? (appId.length > 0 && !appId.includes('sandbox-')) : true;
  const isProductionToken = cleanToken.startsWith('EAAAEv') || cleanToken.startsWith('EAAAl7');
  const environment = (isProductionAppId || isProductionToken) ? SquareEnvironment.Production : SquareEnvironment.Sandbox;
  // v40+ flat-client SDK shape (task #603 / Phase 2 of #600). Note the
  // option key is `token` now, not `accessToken`, and the environment
  // values are URLs from the SquareEnvironment record (Production /
  // Sandbox), not the legacy `Environment` enum.
  return new SquareClient({ token: cleanToken, environment });
}

export class SquarePaymentProvider implements PaymentProvider, CatalogProvider, WalletProvider {
  readonly providerName = 'square';
  readonly locationId: number;

  constructor(locationId: number) {
    this.locationId = locationId;
  }

  private async getSquareClient(): Promise<SquareClient | null> {
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
        throw new PaymentProviderError(
          'Missing required payment information',
          'INVALID_REQUEST',
        );
      }

      if (amount <= 0 || !Number.isInteger(amount)) {
        throw new PaymentProviderError(
          'Invalid payment amount',
          'INVALID_AMOUNT',
        );
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

      const response = await client.payments.create(paymentRequest);

      if (!response?.payment) {
        throw new PaymentProviderError(
          'Unable to process payment',
          'INVALID_RESPONSE',
        );
      }

      const payment = response.payment;
      const cardDetails = payment.cardDetails?.card;

      return {
        id: payment.id,
        status: payment.status,
        card: {
          last4: cardDetails?.last4 ?? '****',
          brand: cardDetails?.cardBrand ?? 'UNKNOWN'
        },
        // capture Square's hosted-receipt URL + short
        // receipt number off the CreatePayment response so the
        // route can persist them on the payments row.
        receiptUrl: payment.receiptUrl,
        receiptNumber: payment.receiptNumber,
      };
    } catch (error) {
      // PaymentProviderError throws above (or ProviderNotConfiguredError
      // from getSquareClient) are already user-safe — re-throw them
      // verbatim so the route's catch sees the original code/message
      // rather than the generic PAYMENT_FAILED below.
      if (
        error instanceof PaymentProviderError ||
        error instanceof ProviderNotConfiguredError
      ) {
        throw error;
      }
      // v40+ flat-client SDK exposes structured errors directly on the
      // SquareError instance (`.errors[]`, `.statusCode`, `.body`); the
      // legacy `.result.errors[]` wrapper is gone. We capture the first
      // `detail` for server-side logs only — never forwarded to the user.
      const apiErr = error instanceof SquareError ? error : null;
      const detail = apiErr?.errors?.[0]?.detail;
      if (apiErr?.statusCode === 400) {
        throw new PaymentProviderError(
          'Invalid payment information. Please check your card details.',
          'INVALID_REQUEST',
          detail,
        );
      }
      if (apiErr?.statusCode === 401) {
        throw new PaymentProviderError(
          'Payment system is temporarily unavailable. Please try again later.',
          'SYSTEM_ERROR',
          detail,
        );
      }
      if (apiErr?.statusCode === 402) {
        throw new PaymentProviderError(
          'Your payment was declined. Please try a different card.',
          'PAYMENT_DECLINED',
          detail,
        );
      }
      throw new PaymentProviderError(
        'Unable to process your payment. Please try again later.',
        'PAYMENT_FAILED',
        detail,
      );
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
      throw new PaymentProviderError(
        'Square location not configured for this location',
        'CONFIGURATION_ERROR',
      );
    }

    try {
      const locationId = squareLocationId;
      const orderResponse = await client.orders.create({
        order: {
          locationId,
          lineItems,
        },
        idempotencyKey: idempotencyKey ? `${idempotencyKey}-order` : `order-${Date.now()}-${Math.random()}`,
      });

      const order = orderResponse.order;
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

      const paymentResponse = await client.payments.create(paymentRequest);

      if (!paymentResponse?.payment) {
        throw new PaymentProviderError(
          'Unable to process payment',
          'INVALID_RESPONSE',
        );
      }

      const payment = paymentResponse.payment;
      const cardDetails = payment.cardDetails?.card;

      return {
        id: payment.id,
        status: payment.status,
        orderId: order.id,
        card: {
          last4: cardDetails?.last4 ?? '****',
          brand: cardDetails?.cardBrand ?? 'UNKNOWN',
        },
        // same hosted-receipt capture as processPayment.
        receiptUrl: payment.receiptUrl,
        receiptNumber: payment.receiptNumber,
      };
    } catch (error) {
      log.error('Order+Payment error:', error);
      // Re-throw already-typed errors verbatim so the route's catch
      // sees the original `userMessage`/`code` we set above (or the
      // PNCE from getSquareClient/getSquareLocationId).
      if (
        error instanceof PaymentProviderError ||
        error instanceof ProviderNotConfiguredError
      ) {
        throw error;
      }
      const apiErr = error instanceof SquareError ? error : null;
      const detail = apiErr?.errors?.[0]?.detail;
      if (apiErr?.statusCode === 402) {
        throw new PaymentProviderError(
          'Your payment was declined. Please try a different card.',
          'PAYMENT_DECLINED',
          detail,
        );
      }
      if (apiErr?.statusCode === 400) {
        // Raw `detail` is captured for logs only — the user gets the
        // hand-authored sentence regardless of what Square returned.
        throw new PaymentProviderError(
          'Payment could not be processed. Please check your details and try again.',
          'INVALID_REQUEST',
          detail,
        );
      }
      throw new PaymentProviderError(
        'Payment processing failed. Please try again.',
        'PAYMENT_FAILED',
        detail,
      );
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

      const response = await client.refunds.refundPayment({
        idempotencyKey,
        paymentId,
        amountMoney: {
          amount: BigInt(amountInCents),
          currency: 'USD',
        },
        reason: reason || 'Refund processed via LeagueVault',
      });

      const refund = response.refund;
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
      // Re-throw already-typed errors verbatim so the route's catch
      // sees the original `userMessage`/`code` (and the PNCE from
      // getSquareClient never gets re-wrapped into REFUND_FAILED).
      if (
        error instanceof PaymentProviderError ||
        error instanceof ProviderNotConfiguredError
      ) {
        throw error;
      }

      // Parity with processPayment / createOrderWithPayment above and
      // CloverPaymentProvider.refundPayment below: collapse any Square
      // SDK error shape into a typed PaymentProviderError so the refund
      // route can show admins the actionable reason (declined card,
      // validation error, system error) instead of a generic wall.
      // v40+ flat-client SDK exposes structured errors directly on the
      // SquareError instance (`.errors[]`, `.statusCode`); the legacy
      // `.result.errors[]` wrapper is gone. Raw Square `detail` is
      // captured for logs only — never forwarded as the user-facing
      // `userMessage` (task #514).
      const apiErr = error instanceof SquareError ? error : null;
      const detail = apiErr?.errors?.[0]?.detail;
      if (apiErr?.statusCode === 401 || apiErr?.statusCode === 403) {
        throw new PaymentProviderError(
          'Payment system is temporarily unavailable. Please try again later.',
          'SYSTEM_ERROR',
          detail,
        );
      }
      if (apiErr?.statusCode === 402) {
        throw new PaymentProviderError(
          'Your payment was declined. Please try a different card.',
          'PAYMENT_DECLINED',
          detail,
        );
      }
      if (typeof apiErr?.statusCode === 'number' && apiErr.statusCode >= 400 && apiErr.statusCode < 500) {
        throw new PaymentProviderError(
          'Invalid payment information. Please check your card details.',
          'INVALID_REQUEST',
          detail,
        );
      }
      throw new PaymentProviderError(
        'Refund could not be processed.',
        'REFUND_FAILED',
        detail,
      );
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
      const response = await client.cards.create({
        // Idempotency key shape preserved across the v40 SDK upgrade
        // so post-deploy retries dedupe against any pre-upgrade
        // saveCardOnFile request still in flight on Square's side.
        idempotencyKey: crypto.createHash('sha256').update(`card:${sourceId}:${customerId}`).digest('hex'),
        sourceId,
        card: {
          customerId,
        },
      });

      const card = response.card;
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
      // v40+ flat-client `cards.list` returns a Page<Card>. We're only
      // interested in the first page (Square caps the response at 25
      // cards per the API docs, which is well below any single bowler's
      // realistic saved-card count).
      const page = await client.cards.list({ customerId });
      const cards = page.data ?? [];
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

    const listPage = await client.cards.list({ customerId });
    const cards = listPage.data ?? [];
    const cardBelongsToCustomer = cards.some(c => c.id === cardId);
    if (!cardBelongsToCustomer) {
      throw new Error('Card does not belong to this customer');
    }

    await client.cards.disable({ cardId });
  }

  async createOrUpdateCustomer(
    name: string,
    email: string,
    phone?: string | null,
    // Optional `bowler:<id>` reference (task #429). When provided we
    // pass it through as Square's `referenceId` so the seller can see
    // the LeagueVault bowler id directly in the Square dashboard.
    referenceId?: string | null,
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
      const searchResponse = await client.customers.search({
        query: {
          filter: {
            emailAddress: {
              exact: email.toLowerCase()
            }
          }
        }
      });

      // v40+ flat-client returns the response body directly (no
      // `.result` wrapper). An undefined response means a transport-
      // level oddity rather than a Square-rejected request — surface
      // it so the catch below maps it to our generic error.
      if (!searchResponse) {
        throw new Error('API Error: Invalid search response');
      }

      let customerId: string;
      const [firstName, ...lastNameParts] = name.split(' ');
      const lastName = lastNameParts.join(' ');
      const phoneNumber = phone || undefined;
      // Only include referenceId in the payload when a non-empty value
      // was supplied. Sending `referenceId: undefined` is a no-op, but
      // sending `null` would CLEAR an existing reference on the Square
      // side — which we never want from this code path.
      const referenceIdField =
        referenceId && referenceId.trim().length > 0
          ? { referenceId: referenceId.trim() }
          : {};

      if (searchResponse.customers?.[0]?.id) {
        if (isDev) log.info('Found existing customer, updating...');
        customerId = searchResponse.customers[0].id;
        // v40+ folds the customerId into the request body itself.
        const updateResponse = await client.customers.update({
          customerId,
          givenName: firstName,
          familyName: lastName || '',
          emailAddress: email.toLowerCase(),
          ...(phoneNumber && { phoneNumber }),
          ...referenceIdField,
        });

        if (!updateResponse?.customer) {
          throw new Error('API Error: Invalid update response');
        }

        if (isDev) log.info('Customer updated successfully:', updateResponse.customer.id);
      } else {
        if (isDev) log.info('No existing customer found, creating new...');
        const customerResponse = await client.customers.create({
          // Idempotency key shape preserved across the v40 SDK upgrade
          // so a retry post-deploy still dedupes against the in-flight
          // pre-upgrade request on Square's side.
          idempotencyKey: crypto.createHash('sha256').update(`customer:${email.toLowerCase()}:${name}`).digest('hex'),
          givenName: firstName,
          familyName: lastName || '',
          emailAddress: email.toLowerCase(),
          ...(phoneNumber && { phoneNumber }),
          ...referenceIdField,
        });

        if (!customerResponse?.customer?.id) {
          throw new Error('API Error: Invalid create response');
        }

        customerId = customerResponse.customer.id;
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

  // Per-Square-seller bootstrap cache for the league_name/league_season
  // custom attribute definitions (task #429). Keyed by locationId
  // because that's the unit our credentials are addressed by, even
  // though definitions are seller-scoped on Square's side. In the
  // multi-location-same-seller case we may issue a couple of redundant
  // "already exists" requests on first hits — those return fast and
  // are treated as success by `ensureDefinitions`.
  //
  // We deliberately only cache a TRUE result. A false (failure) flips
  // the cache to absent so the next call retries — otherwise a brief
  // Square outage during cold-start would poison the cache for the
  // life of the process.
  private static readonly definitionsBootstrapped = new Map<number, true>();

  /**
   * Test-only: clear the per-process bootstrap cache so unit tests
   * can verify the lazy-bootstrap path runs again.
   */
  static __clearDefinitionsBootstrapCacheForTests(): void {
    SquarePaymentProvider.definitionsBootstrapped.clear();
  }

  private async ensureDefinitionsOnce(client: SquareClient): Promise<boolean> {
    if (SquarePaymentProvider.definitionsBootstrapped.get(this.locationId)) {
      return true;
    }
    const ok = await ensureDefinitions(client);
    if (ok) {
      SquarePaymentProvider.definitionsBootstrapped.set(this.locationId, true);
    }
    return ok;
  }

  /**
   * Public bootstrap entry point used by the startup pass in
   * `server/index.ts`. Pre-creates the league_name + league_season
   * custom-attribute definitions on this seller account so the very
   * first customer-attr write of the process is fast (and so the
   * definitions exist even before any bowler has been synced this
   * boot). NON-FATAL: any failure leaves the cache empty so the lazy
   * path retries on next use.
   */
  async ensureCustomAttributeDefinitions(): Promise<boolean> {
    let client: SquareClient | null;
    try {
      client = await this.getSquareClient();
    } catch {
      return false;
    }
    if (!client) return false;
    return this.ensureDefinitionsOnce(client);
  }

  /**
   * Pushes the bowler's current league_name + league_season strings to
   * the customer's Square profile (task #429). NON-FATAL by contract —
   * see `Failure semantics` below — the customer record itself is
   * always considered the primary write and must never be rolled back
   * because of an attribute upsert failure.
   *
   * Failure semantics:
   *   - "Definition does not exist yet" → bootstrap once, retry once.
   *     If bootstrap *itself* failed, leave the cache empty so the
   *     next call retries.
   *   - Hard upsert failure → log + return ok:false so the caller can
   *     flip `bowlers.payment_sync_pending_at`. The retry sweep picks
   *     it up on the next tick.
   *   - Provider not configured → return ok:true and skip silently.
   *     There is no Square customer to update on this location, so
   *     there is nothing to retry.
   *
   * Empty strings ARE written: that's how we tell Square "this bowler
   * is no longer in any leagues" rather than leaving a stale value
   * from a previous sync.
   */
  async syncCustomerLeagueAttributes(
    customerId: string,
    bowlerId: number,
    attributes: { leagueName: string; leagueSeason: string },
  ): Promise<{ ok: boolean }> {
    let client: SquareClient | null;
    try {
      client = await this.getSquareClient();
    } catch (err) {
      log.warn('Custom-attr sync: failed to get Square client', {
        locationId: this.locationId,
        error: err instanceof Error ? { name: err.name, message: err.message } : err,
      });
      return { ok: false };
    }
    if (!client) {
      // Same convention as the rest of the provider: missing creds
      // means "skip silently", not "fail loudly". The caller already
      // gated on Square being configured for this location.
      return { ok: true };
    }

    // Lazy bootstrap. The first call per cold-start per Square seller
    // pays the cost of two definition-create round trips; everything
    // after that is in-memory cached.
    let bootstrapped = await this.ensureDefinitionsOnce(client);

    const writeBoth = async (): Promise<{ ok: boolean; definitionMissing: boolean }> => {
      const nameRes = await upsertCustomerStringAttribute(
        client!,
        customerId,
        LEAGUE_NAME_KEY,
        attributes.leagueName,
        bowlerId,
      );
      const seasonRes = await upsertCustomerStringAttribute(
        client!,
        customerId,
        LEAGUE_SEASON_KEY,
        attributes.leagueSeason,
        bowlerId,
      );
      const ok = nameRes.ok && seasonRes.ok;
      const definitionMissing =
        (!nameRes.ok && nameRes.reason === 'definition_missing') ||
        (!seasonRes.ok && seasonRes.reason === 'definition_missing');
      return { ok, definitionMissing };
    };

    let result = await writeBoth();
    // Force one bootstrap + single retry when EITHER:
    //   (a) we never successfully bootstrapped this process (cold-
    //       start failure), OR
    //   (b) the cache says we DID bootstrap but Square still rejected
    //       the upsert with definition-missing — meaning the
    //       definition was deleted out-of-band (e.g. a seller manually
    //       removed it from their Square dashboard, or another app on
    //       the same seller account did so via the API). Bust the
    //       cache so the next call also re-bootstraps.
    if (!result.ok && (!bootstrapped || result.definitionMissing)) {
      if (result.definitionMissing && bootstrapped) {
        log.warn('Custom-attr sync: definition missing despite cached bootstrap; busting cache', {
          bowlerId,
          customerId,
          locationId: this.locationId,
        });
        SquarePaymentProvider.definitionsBootstrapped.delete(this.locationId);
      }
      log.info('Custom-attr sync: retrying after forced bootstrap', { bowlerId, customerId });
      bootstrapped = await ensureDefinitions(client);
      if (bootstrapped) {
        SquarePaymentProvider.definitionsBootstrapped.set(this.locationId, true);
        result = await writeBoth();
      }
    }

    if (!result.ok) {
      log.warn('Custom-attr sync: leaving bowler flagged for retry', {
        bowlerId,
        customerId,
        locationId: this.locationId,
      });
    }
    return result;
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
      await client.customers.delete({ customerId });
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
      const response = await client.payments.get({ paymentId });
      const payment = response.payment;
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
        // surface receipt fields off GetPayment so the
        // "View receipt" route can lazily backfill an older row.
        receiptUrl: payment.receiptUrl,
        receiptNumber: payment.receiptNumber,
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
        // v40+ flat-client `catalog.list` returns a Page<CatalogObject>;
        // we walk the cursor manually so the existing per-page accumulation
        // semantics are preserved verbatim.
        const page = await client.catalog.list({ cursor, types: 'CATEGORY' });
        const objects = page.data ?? [];
        allObjects.push(...objects);
        cursor = page.response?.cursor || undefined;
      } while (cursor);

      // v40+ CatalogObject is a discriminated union via `type`. Narrow
      // to the CATEGORY variant so `categoryData` is reachable, and
      // drop any object missing an id (now `string | undefined` on the
      // SDK side — in practice always present for persisted objects).
      const seen = new Set<string>();
      const deduped = allObjects
        .filter((cat): cat is CatalogObject & { type: 'CATEGORY' } => cat.type === 'CATEGORY')
        .filter((cat) => !cat.isDeleted && cat.id)
        .map((cat) => ({
          id: cat.id ?? '',
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
      // The mapper is identical for both branches (search-by-category
      // and the unscoped first-page list). Pulled out so the
      // discriminated-union narrowing on `type === 'ITEM'` lives in
      // one place, and so a future tweak to the consumer-facing
      // CatalogItem shape only has to be made once.
      type ItemObject = CatalogObject & { type: 'ITEM' };
      type VariationObject = CatalogObject & { type: 'ITEM_VARIATION' };
      const isItemObject = (obj: CatalogObject): obj is ItemObject => obj.type === 'ITEM';
      const isVariationObject = (obj: CatalogObject): obj is VariationObject =>
        obj.type === 'ITEM_VARIATION';
      const toCatalogItem = (item: ItemObject): CatalogItem => {
        // CatalogItem.variations is itself a CatalogObject[] (the
        // discriminated wrapper, not CatalogItemVariation directly), so
        // narrow each entry to the ITEM_VARIATION variant before reading
        // `itemVariationData`.
        const variations = (item.itemData?.variations ?? [])
          .filter(isVariationObject)
          .map((v) => ({
            id: v.id ?? '',
            name: v.itemVariationData?.name || 'Default',
            price: v.itemVariationData?.priceMoney?.amount
              ? Number(v.itemVariationData.priceMoney.amount)
              : null,
            currency: v.itemVariationData?.priceMoney?.currency || 'USD',
          }));

        return {
          id: item.id ?? '',
          name: item.itemData?.name || 'Unnamed Item',
          description: item.itemData?.description || '',
          variations,
        };
      };

      if (categoryId) {
        const response = await client.catalog.searchItems({
          categoryIds: [categoryId],
        });
        const items = response.items ?? [];
        // `searchItems` returns CatalogObject[] in v40+; narrow to the
        // ITEM variant so `itemData` is reachable on the union.
        return items.filter(isItemObject).map(toCatalogItem);
      }

      // Single-page fetch retains the legacy "first page only" behavior;
      // operators with >1000 catalog items see the same first-page slice
      // they did pre-upgrade. Pagination is the responsibility of
      // categoryId-scoped lookups above.
      const page = await client.catalog.list({ types: 'ITEM' });
      const objects = page.data ?? [];
      return objects.filter(isItemObject).map(toCatalogItem);
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
      await client.applePay.registerDomain({ domainName: domain });
      log.info(`Apple Pay domain registered: ${domain}`);
      return { success: true, message: `Domain ${domain} registered for Apple Pay` };
    } catch (error) {
      // v40+ flat-client SDK exposes structured errors directly on the
      // SquareError instance — no `.result` wrapper. We read the first
      // `detail` for the operator-facing message.
      const detail =
        error instanceof SquareError ? error.errors?.[0]?.detail : undefined;
      log.error('Apple Pay domain registration error:', detail || error);
      return { success: false, message: detail || 'Failed to register domain for Apple Pay' };
    }
  }
}
