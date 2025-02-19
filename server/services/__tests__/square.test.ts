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
  };
}>;

type SearchCustomersResponse = ApiResponse<{
  customers: Array<{ id: string; }>;
}>;

type PaymentResponse = ApiResponse<{
  payment: {
    id: string;
    status: string;
    cardDetails: {
      card: {
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
  default: {
    Client: jest.fn().mockImplementation(() => createMockClient())
  }
}));

describe('Square Service', () => {
  const mockEnv = process.env;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...mockEnv };
    process.env.SQUARE_ACCESS_TOKEN = 'test-token';
    mockClient = createMockClient();
    (jest.requireMock('square') as any).default.Client.mockImplementation(() => mockClient);
  });

  afterEach(() => {
    process.env = mockEnv;
    jest.clearAllMocks();
  });

  describe('createOrUpdateCustomer', () => {
    it('should create a new customer when one does not exist', async () => {
      const searchResponse: SearchCustomersResponse = {
        result: { customers: [] }
      };
      const createResponse: CustomerResponse = {
        result: {
          customer: {
            id: 'test-customer-id'
          }
        }
      };

      mockClient.customersApi.searchCustomers.mockResolvedValueOnce(searchResponse);
      mockClient.customersApi.createCustomer.mockResolvedValueOnce(createResponse);

      const result = await createOrUpdateCustomer('John Doe', 'john@example.com');

      expect(result).toEqual({
        id: 'test-customer-id',
        name: 'John Doe',
        email: 'john@example.com'
      });
    });

    it('should update an existing customer', async () => {
      const searchResponse: SearchCustomersResponse = {
        result: {
          customers: [{
            id: 'existing-customer-id'
          }]
        }
      };

      mockClient.customersApi.searchCustomers.mockResolvedValueOnce(searchResponse);

      const result = await createOrUpdateCustomer('John Doe', 'john@example.com');

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
      } as PaymentResponse);

      const result = await processPayment('source-id', 1000, 'location-id');

      expect(result).toEqual({
        id: 'payment-id',
        status: 'COMPLETED',
        card: {
          last4: '1234',
          brand: 'VISA'
        }
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
      ).rejects.toThrow('API Error');
    });
  });
});