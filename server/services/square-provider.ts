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
import {
  processPayment as sqProcessPayment,
  createOrderWithPayment as sqCreateOrderWithPayment,
  refundPayment as sqRefundPayment,
  saveCardOnFile as sqSaveCardOnFile,
  listCardsOnFile as sqListCardsOnFile,
  disableCard as sqDisableCard,
  createOrUpdateCustomer as sqCreateOrUpdateCustomer,
  getSquarePayment,
  listCatalogCategories as sqListCatalogCategories,
  listCatalogItems as sqListCatalogItems,
  registerApplePayDomain as sqRegisterApplePayDomain,
} from './square';

export class SquarePaymentProvider implements PaymentProvider, CatalogProvider, WalletProvider {
  readonly providerName = 'square';
  private readonly locationId: number;

  constructor(locationId: number) {
    this.locationId = locationId;
  }

  async processPayment(
    sourceId: string,
    amount: number,
    storeCard?: boolean,
    customerId?: string,
    buyerEmail?: string,
    idempotencyKey?: string,
  ): Promise<PaymentResult> {
    return sqProcessPayment(sourceId, amount, storeCard, customerId, buyerEmail, idempotencyKey, this.locationId);
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
    return sqCreateOrderWithPayment(sourceId, amount, lineItems, this.locationId, storeCard, customerId, buyerEmail, idempotencyKey);
  }

  async refundPayment(
    paymentId: string,
    amountInCents: number,
    reason?: string,
  ): Promise<RefundResult> {
    return sqRefundPayment(paymentId, amountInCents, reason, this.locationId);
  }

  async saveCardOnFile(
    sourceId: string,
    customerId: string,
  ): Promise<SavedCard | null> {
    return sqSaveCardOnFile(sourceId, customerId, this.locationId);
  }

  async listCardsOnFile(
    customerId: string,
  ): Promise<SavedCard[]> {
    return sqListCardsOnFile(customerId, this.locationId);
  }

  async disableCard(
    cardId: string,
    customerId: string,
  ): Promise<void> {
    return sqDisableCard(cardId, customerId, this.locationId);
  }

  async createOrUpdateCustomer(
    name: string,
    email: string,
    phone?: string | null,
  ): Promise<PaymentCustomer | null> {
    return sqCreateOrUpdateCustomer(name, email, phone, this.locationId);
  }

  async getPayment(
    paymentId: string,
  ): Promise<PaymentVerification | null> {
    return getSquarePayment(paymentId, this.locationId);
  }

  validateCardId(cardId: string | null): boolean {
    if (!cardId) return false;
    return cardId.startsWith('ccof:');
  }

  async listCatalogCategories(): Promise<CatalogCategory[]> {
    return sqListCatalogCategories(this.locationId);
  }

  async listCatalogItems(categoryId?: string): Promise<CatalogItem[]> {
    return sqListCatalogItems(categoryId, this.locationId);
  }

  async registerApplePayDomain(domain: string): Promise<{ success: boolean; message: string }> {
    return sqRegisterApplePayDomain(domain, this.locationId);
  }
}
