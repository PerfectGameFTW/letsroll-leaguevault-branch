import { describe, it, expect, beforeEach, vi } from 'vitest';

// v40+ flat-client SDK shape (task #603 / Phase 2 of #600). Resources
// live under singular lowercase getters (`customers`, `payments`, ...)
// and methods return the response body directly with no `.result`
// wrapper. The mock here mirrors that shape so the SquarePaymentProvider
// under test consumes the same fields it will see in production.
const mocks = vi.hoisted(() => {
  return {
    customers: {
      search: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    payments: {
      create: vi.fn(),
    },
    getLocationSquareConfig: vi.fn(),
  };
});

vi.mock('square', () => ({
  SquareClient: function () {
    return {
      customers: mocks.customers,
      payments: mocks.payments,
    };
  },
  SquareEnvironment: { Production: 'production', Sandbox: 'sandbox' },
  // Provide a constructable SquareError so production code's
  // `error instanceof SquareError` narrowing path can be exercised by
  // tests that want to simulate a Square-side failure.
  SquareError: class SquareError extends Error {
    statusCode?: number;
    body?: unknown;
    errors?: Array<{ category?: string; code?: string; detail?: string; field?: string }>;
    constructor(args: {
      message?: string;
      statusCode?: number;
      body?: unknown;
      errors?: Array<{ category?: string; code?: string; detail?: string; field?: string }>;
    } = {}) {
      super(args.message ?? 'SquareError');
      this.name = 'SquareError';
      this.statusCode = args.statusCode;
      this.body = args.body;
      this.errors = args.errors;
    }
  },
}));

vi.mock('../../storage', () => ({
  storage: {
    getLocationSquareConfig: (...args: unknown[]) => mocks.getLocationSquareConfig(...args),
  },
}));

vi.mock('../../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { SquarePaymentProvider } = await import('../square-provider.js');

describe('Square Service', () => {
  let provider: InstanceType<typeof SquarePaymentProvider>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLocationSquareConfig.mockResolvedValue({
      accessToken: 'EAAAEv-test-token',
      appId: 'sq0idp-test',
      locationId: 'LOC123',
    });
    provider = new SquarePaymentProvider(1);
  });

  describe('createOrUpdateCustomer', () => {
    it('should create a new customer when one does not exist', async () => {
      mocks.customers.search.mockResolvedValueOnce({
        customers: [],
      });

      mocks.customers.create.mockResolvedValueOnce({
        customer: {
          id: 'test-customer-id',
          givenName: 'John',
          familyName: 'Doe',
          emailAddress: 'john@example.com',
        },
      });

      const result = await provider.createOrUpdateCustomer('John Doe', 'john@example.com', null);

      expect(result).toEqual({
        id: 'test-customer-id',
        name: 'John Doe',
        email: 'john@example.com',
      });

      expect(mocks.customers.create).toHaveBeenCalledWith(
        expect.objectContaining({
          givenName: 'John',
          familyName: 'Doe',
          emailAddress: 'john@example.com',
        }),
      );
    });

    it('should update an existing customer', async () => {
      mocks.customers.search.mockResolvedValueOnce({
        customers: [
          {
            id: 'existing-customer-id',
            givenName: 'John',
            familyName: 'Doe',
            emailAddress: 'john@example.com',
          },
        ],
      });

      mocks.customers.update.mockResolvedValueOnce({
        customer: {
          id: 'existing-customer-id',
          givenName: 'John',
          familyName: 'Doe',
          emailAddress: 'john@example.com',
        },
      });

      const result = await provider.createOrUpdateCustomer('John Doe', 'john@example.com', null);

      expect(result).toEqual({
        id: 'existing-customer-id',
        name: 'John Doe',
        email: 'john@example.com',
      });

      // v40+ folds customerId into the request body (no positional arg).
      expect(mocks.customers.update).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'existing-customer-id',
        }),
      );
    });

    it('throws ProviderNotConfiguredError when no Square credentials configured (task #332)', async () => {
      mocks.getLocationSquareConfig.mockResolvedValue(null);
      const noCredsProvider = new SquarePaymentProvider(999);
      await expect(
        noCredsProvider.createOrUpdateCustomer('John Doe', 'john@example.com'),
      ).rejects.toMatchObject({
        name: 'ProviderNotConfiguredError',
        code: 'PROVIDER_NOT_CONFIGURED',
        locationId: 999,
      });
    });

    it('should handle API errors', async () => {
      mocks.customers.search.mockRejectedValueOnce(new Error('API Error'));

      await expect(
        provider.createOrUpdateCustomer('John Doe', 'john@example.com', null),
      ).rejects.toThrow('Failed to create/update Square customer: API Error');
    });
  });

  describe('processPayment', () => {
    it('should process payment successfully', async () => {
      mocks.payments.create.mockResolvedValueOnce({
        payment: {
          id: 'payment-id',
          status: 'COMPLETED',
          cardDetails: {
            card: {
              last4: '1234',
              cardBrand: 'VISA',
            },
          },
        },
      });

      const result = await provider.processPayment('source-id', 1000, false);

      expect(result).toEqual({
        id: 'payment-id',
        status: 'COMPLETED',
        card: {
          last4: '1234',
          brand: 'VISA',
        },
      });

      expect(mocks.payments.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceId: 'source-id',
          amountMoney: {
            amount: BigInt(1000),
            currency: 'USD',
          },
        }),
      );
    });

    it('throws ProviderNotConfiguredError when no Square credentials configured (task #332)', async () => {
      mocks.getLocationSquareConfig.mockResolvedValue(null);
      const noCredsProvider = new SquarePaymentProvider(999);
      await expect(
        noCredsProvider.processPayment('source-id', 1000),
      ).rejects.toMatchObject({
        name: 'ProviderNotConfiguredError',
        code: 'PROVIDER_NOT_CONFIGURED',
        locationId: 999,
      });
    });
  });

  // Task #332: every Square wallet/customer/payment method that
  // previously returned `{ success: false }` or null when the
  // Square client wasn't configured now throws
  // ProviderNotConfiguredError, so the routes can map it to a
  // uniform 422 PROVIDER_NOT_CONFIGURED. The four read-only
  // methods (listCardsOnFile, getPayment, listCatalogCategories,
  // listCatalogItems) intentionally stay degraded — pinned below.
  describe('ProviderNotConfiguredError contract (task #332)', () => {
    let noCredsProvider: InstanceType<typeof SquarePaymentProvider>;

    beforeEach(() => {
      mocks.getLocationSquareConfig.mockResolvedValue(null);
      noCredsProvider = new SquarePaymentProvider(999);
    });

    const expectsPnce = (p: Promise<unknown>) =>
      expect(p).rejects.toMatchObject({
        name: 'ProviderNotConfiguredError',
        code: 'PROVIDER_NOT_CONFIGURED',
        locationId: 999,
      });

    it('processPayment throws PNCE', async () => {
      await expectsPnce(noCredsProvider.processPayment('src', 1000));
    });

    it('createOrderWithPayment throws PNCE', async () => {
      await expectsPnce(noCredsProvider.createOrderWithPayment('src', 1000, []));
    });

    it('refundPayment throws PNCE', async () => {
      await expectsPnce(noCredsProvider.refundPayment('pay-id', 1000));
    });

    it('saveCardOnFile throws PNCE', async () => {
      await expectsPnce(noCredsProvider.saveCardOnFile('src', 'cust'));
    });

    it('disableCard throws PNCE', async () => {
      await expectsPnce(noCredsProvider.disableCard('card-id', 'cust'));
    });

    it('createOrUpdateCustomer throws PNCE', async () => {
      await expectsPnce(noCredsProvider.createOrUpdateCustomer('John', 'j@x.com'));
    });

    it('deleteCustomer throws PNCE', async () => {
      await expectsPnce(noCredsProvider.deleteCustomer('cust-id'));
    });

    it('registerApplePayDomain throws PNCE (task #302 baseline)', async () => {
      await expectsPnce(noCredsProvider.registerApplePayDomain('example.com'));
    });

    // Read-only methods kept intentionally degraded — pin the
    // contract so a future refactor doesn't accidentally flip
    // them to throwing without revisiting their callers.
    it('listCardsOnFile stays degraded (returns [])', async () => {
      await expect(noCredsProvider.listCardsOnFile('cust')).resolves.toEqual([]);
    });

    it('getPayment stays degraded (returns null)', async () => {
      await expect(noCredsProvider.getPayment('pay-id')).resolves.toBeNull();
    });

    it('listCatalogCategories stays degraded (returns [])', async () => {
      await expect(noCredsProvider.listCatalogCategories()).resolves.toEqual([]);
    });

    it('listCatalogItems stays degraded (returns [])', async () => {
      await expect(noCredsProvider.listCatalogItems()).resolves.toEqual([]);
    });
  });
});
