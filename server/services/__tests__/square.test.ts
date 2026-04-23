import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  return {
    customersApi: {
      searchCustomers: vi.fn(),
      updateCustomer: vi.fn(),
      createCustomer: vi.fn(),
    },
    paymentsApi: {
      createPayment: vi.fn(),
    },
    getLocationSquareConfig: vi.fn(),
  };
});

vi.mock('square', () => ({
  Client: function () {
    return {
      customersApi: mocks.customersApi,
      paymentsApi: mocks.paymentsApi,
    };
  },
  Environment: { Production: 'production', Sandbox: 'sandbox' },
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
      mocks.customersApi.searchCustomers.mockResolvedValueOnce({
        result: { customers: [] },
      });

      mocks.customersApi.createCustomer.mockResolvedValueOnce({
        result: {
          customer: {
            id: 'test-customer-id',
            givenName: 'John',
            familyName: 'Doe',
            emailAddress: 'john@example.com',
          },
        },
      });

      const result = await provider.createOrUpdateCustomer('John Doe', 'john@example.com', null);

      expect(result).toEqual({
        id: 'test-customer-id',
        name: 'John Doe',
        email: 'john@example.com',
      });

      expect(mocks.customersApi.createCustomer).toHaveBeenCalledWith(
        expect.objectContaining({
          givenName: 'John',
          familyName: 'Doe',
          emailAddress: 'john@example.com',
        }),
      );
    });

    it('should update an existing customer', async () => {
      mocks.customersApi.searchCustomers.mockResolvedValueOnce({
        result: {
          customers: [
            {
              id: 'existing-customer-id',
              givenName: 'John',
              familyName: 'Doe',
              emailAddress: 'john@example.com',
            },
          ],
        },
      });

      mocks.customersApi.updateCustomer.mockResolvedValueOnce({
        result: {
          customer: {
            id: 'existing-customer-id',
            givenName: 'John',
            familyName: 'Doe',
            emailAddress: 'john@example.com',
          },
        },
      });

      const result = await provider.createOrUpdateCustomer('John Doe', 'john@example.com', null);

      expect(result).toEqual({
        id: 'existing-customer-id',
        name: 'John Doe',
        email: 'john@example.com',
      });

      expect(mocks.customersApi.updateCustomer).toHaveBeenCalledWith(
        'existing-customer-id',
        expect.any(Object),
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
      mocks.customersApi.searchCustomers.mockRejectedValueOnce(new Error('API Error'));

      await expect(
        provider.createOrUpdateCustomer('John Doe', 'john@example.com', null),
      ).rejects.toThrow('Failed to create/update Square customer: API Error');
    });
  });

  describe('processPayment', () => {
    it('should process payment successfully', async () => {
      mocks.paymentsApi.createPayment.mockResolvedValueOnce({
        result: {
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

      expect(mocks.paymentsApi.createPayment).toHaveBeenCalledWith(
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
