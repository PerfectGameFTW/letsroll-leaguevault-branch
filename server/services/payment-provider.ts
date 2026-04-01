export interface PaymentResult {
  id?: string;
  status?: string;
  orderId?: string;
  card?: {
    last4: string;
    brand: string;
  };
  providerRef?: Record<string, string>;
}

export interface RefundResult {
  refundId: string;
  status: string;
}

export interface SavedCard {
  id: string;
  last4: string;
  brand: string;
  expMonth?: number;
  expYear?: number;
}

export interface PaymentCustomer {
  id: string;
  name: string;
  email: string;
}

export interface PaymentVerification {
  id: string;
  status: string;
  amountMoney: { amount: string; currency: string };
  createdAt: string;
  updatedAt: string;
  sourceType: string;
  cardBrand?: string;
  last4?: string;
  orderId?: string;
}

export interface OrderLineItem {
  catalogObjectId: string;
  quantity: string;
}

export interface CatalogCategory {
  id: string;
  name: string;
}

export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  variations: {
    id: string;
    name: string;
    price: number | null;
    currency: string;
  }[];
}

export interface PaymentProvider {
  readonly providerName: string;

  processPayment(
    sourceId: string,
    amount: number,
    storeCard?: boolean,
    customerId?: string,
    buyerEmail?: string,
    idempotencyKey?: string,
  ): Promise<PaymentResult>;

  createOrderWithPayment(
    sourceId: string,
    amount: number,
    lineItems: OrderLineItem[],
    storeCard?: boolean,
    customerId?: string,
    buyerEmail?: string,
    idempotencyKey?: string,
  ): Promise<PaymentResult>;

  refundPayment(
    paymentId: string,
    amountInCents: number,
    reason?: string,
  ): Promise<RefundResult>;

  saveCardOnFile(
    sourceId: string,
    customerId: string,
  ): Promise<SavedCard | null>;

  listCardsOnFile(
    customerId: string,
  ): Promise<SavedCard[]>;

  disableCard(
    cardId: string,
    customerId: string,
  ): Promise<void>;

  createOrUpdateCustomer(
    name: string,
    email: string,
    phone?: string | null,
  ): Promise<PaymentCustomer | null>;

  getPayment(
    paymentId: string,
  ): Promise<PaymentVerification | null>;

  validateCardId(cardId: string | null): boolean;
}

/**
 * Optional capability: catalog operations (e.g., Square catalog items/categories).
 * Split from PaymentProvider because not all processors support catalog management.
 * Use hasCatalogSupport() type guard to check at runtime.
 */
export interface CatalogProvider {
  listCatalogCategories(): Promise<CatalogCategory[]>;
  listCatalogItems(categoryId?: string): Promise<CatalogItem[]>;
}

/**
 * Optional capability: digital wallet operations (e.g., Apple Pay domain registration).
 * Split from PaymentProvider because not all processors support wallet payments.
 * Use hasWalletSupport() type guard to check at runtime.
 */
export interface WalletProvider {
  registerApplePayDomain(domain: string): Promise<{ success: boolean; message: string }>;
}

export function hasCatalogSupport(provider: PaymentProvider): provider is PaymentProvider & CatalogProvider {
  return 'listCatalogCategories' in provider && 'listCatalogItems' in provider;
}

export function hasWalletSupport(provider: PaymentProvider): provider is PaymentProvider & WalletProvider {
  return 'registerApplePayDomain' in provider;
}
