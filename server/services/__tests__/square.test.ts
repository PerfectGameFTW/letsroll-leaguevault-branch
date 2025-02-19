import { jest } from '@jest/globals';
import {
  createOrUpdateCustomer,
  processPayment
} from '../square.js';

// Define response types for type checking
type ApiResponse<T> = { result: T };

type CustomerResponse = ApiResponse<{
  customer: {
    id: string;
    givenName?: string;
    familyName?: string;
    emailAddress?: string;
  };
}>;

type SearchCustomersResponse = ApiResponse<{
  customers: Array<{
    id: string;
    givenName?: string;
    familyName?: string;
    emailAddress?: string;
  }>;
}>;

type PaymentResponse = ApiResponse<{
  payment: {
    id: string;
    status: string;
    cardDetails?: {
      card?: {
        last4: string;
        cardBrand: string;
      };
    };
  };
}>;

// Create mock client factory with explicit return types
const createMockClient = () => ({
  customersApi: {
    searchCustomers: jest.fn<() => Promise<SearchCustomersResponse>>(),
    updateCustomer: jest.fn<() => Promise<CustomerResponse>>(),
    createCustomer: jest.fn<() => Promise<CustomerResponse>>(),
  },
  paymentsApi: {
    createPayment: jest.fn<() => Promise<PaymentResponse>>()
  }
});

// Mock Square SDK
jest.mock('square', () => ({
  __esModule: true,
  Client: jest.fn().mockImplementation(() => createMockClient()),
  Environment: {
    Production: 'production',
    Sandbox: 'sandbox'
  }
}));

describe('Square Service', () => {
  const mockEnv = process.env;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...mockEnv };
    process.env.SQUARE_ACCESS_TOKEN = 'test-token';
    process.env.NODE_ENV = 'test';
    mockClient = createMockClient();
    (jest.requireMock('square') as any).Client.mockImplementation(() => mockClient);
  });

  afterEach(() => {
    process.env = mockEnv;
    jest.clearAllMocks();
  });

  describe('createOrUpdateCustomer', () => {
    it('should create a new customer when one does not exist', async () => {
      // Mock empty search response
      mockClient.customersApi.searchCustomers.mockResolvedValueOnce({
        result: {
          customers: []
        }
      });

      // Mock successful customer creation
      mockClient.customersApi.createCustomer.mockResolvedValueOnce({
        result: {
          customer: {
            id: 'test-customer-id',
            givenName: 'John',
            familyName: 'Doe',
            emailAddress: 'john@example.com'
          }
        }
      });

      const result = await createOrUpdateCustomer('John Doe', 'john@example.com');

      expect(result).toEqual({
        id: 'test-customer-id',
        name: 'John Doe',
        email: 'john@example.com'
      });

      expect(mockClient.customersApi.createCustomer).toHaveBeenCalledWith({
        idempotencyKey: expect.any(String),
        givenName: 'John',
        familyName: 'Doe',
        emailAddress: 'john@example.com'
      });
    });

    it('should update an existing customer', async () => {
      // Mock existing customer search response
      mockClient.customersApi.searchCustomers.mockResolvedValueOnce({
        result: {
          customers: [{
            id: 'existing-customer-id',
            givenName: 'John',
            familyName: 'Doe',
            emailAddress: 'john@example.com'
          }]
        }
      });

      // Mock successful customer update
      mockClient.customersApi.updateCustomer.mockResolvedValueOnce({
        result: {
          customer: {
            id: 'existing-customer-id',
            givenName: 'John',
            familyName: 'Doe',
            emailAddress: 'john@example.com'
          }
        }
      });

      const result = await createOrUpdateCustomer('John Doe', 'john@example.com');

      expect(result).toEqual({
        id: 'existing-customer-id',
        name: 'John Doe',
        email: 'john@example.com'
      });

      expect(mockClient.customersApi.updateCustomer).toHaveBeenCalledWith(
        'existing-customer-id',
        expect.any(Object)
      );
    });
  });

  describe('processPayment', () => {
    it('should process payment successfully', async () => {
      mockClient.paymentsApi.createPayment.mockResolvedValueOnce({
        result: {
          payment: {
            id: 'payment-id',
            status: 'COMPLETED',
            cardDetails: {
              card: {
                last4: '1234',
                cardBrand: 'VISA'
              }
            }
          }
        }
      });

      const result = await processPayment('source-id', 1000, 'location-id');

      expect(result).toEqual({
        id: 'payment-id',
        status: 'COMPLETED',
        card: {
          last4: '1234',
          brand: 'VISA'
        }
      });

      expect(mockClient.paymentsApi.createPayment).toHaveBeenCalledWith({
        sourceId: 'source-id',
        idempotencyKey: expect.any(String),
        amountMoney: {
          amount: BigInt(1000),
          currency: 'USD'
        },
        locationId: 'location-id'
      });
    });
  });

  describe('error handling', () => {
    it('should return null when Square client is not initialized', async () => {
      process.env.SQUARE_ACCESS_TOKEN = undefined;
      const result = await createOrUpdateCustomer('John Doe', 'john@example.com');
      expect(result).toBeNull();
    });

    it('should handle API errors', async () => {
      mockClient.customersApi.searchCustomers.mockRejectedValueOnce(
        new Error('API Error')
      );

      await expect(
        createOrUpdateCustomer('John Doe', 'john@example.com')
      ).rejects.toThrow('Failed to create/update Square customer: API Error');
    });
  });
});