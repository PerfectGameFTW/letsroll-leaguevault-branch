import { jest } from '@jest/globals';
import {
  createOrUpdateCustomer,
  addCustomerToLeagueGroup,
  enrollInLoyalty,
  getLoyaltyPoints,
  processPayment
} from '../square';

// Keep interfaces for documentation purposes
interface CustomerResponse {
  customer: {
    id: string;
  };
}

interface SearchCustomersResponse {
  customers: Array<{ id: string }>;
}

interface CustomerGroupResponse {
  group: {
    id: string;
    name?: string;
  };
}

interface CustomerGroupsResponse {
  groups: Array<{
    id: string;
    name: string;
  }>;
}

interface LoyaltyProgramResponse {
  programs: Array<{
    id: string;
  }>;
}

interface LoyaltyAccountResponse {
  loyaltyAccount: {
    id: string;
  };
}

interface PaymentResponse {
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
}

// Create a mock client factory
const createMockClient = () => ({
  customersApi: {
    searchCustomers: jest.fn(),
    updateCustomer: jest.fn(),
    createCustomer: jest.fn(),
    addGroupToCustomer: jest.fn()
  },
  customerGroupsApi: {
    listCustomerGroups: jest.fn(),
    createCustomerGroup: jest.fn()
  },
  loyaltyApi: {
    listLoyaltyPrograms: jest.fn(),
    searchLoyaltyAccounts: jest.fn(),
    createLoyaltyAccount: jest.fn()
  },
  paymentsApi: {
    createPayment: jest.fn()
  }
});

// Mock the Square SDK
jest.mock('square', () => ({
  __esModule: true,
  Square: {
    Client: jest.fn().mockImplementation(createMockClient)
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
    (jest.requireMock('square') as any).Square.Client.mockImplementation(() => mockClient);
  });

  afterEach(() => {
    process.env = mockEnv;
    jest.clearAllMocks();
  });

  describe('createOrUpdateCustomer', () => {
    it('should create a new customer when one does not exist', async () => {
      mockClient.customersApi.searchCustomers.mockResolvedValue({
        result: { customers: [] }
      } as any);

      mockClient.customersApi.createCustomer.mockResolvedValue({
        result: {
          customer: {
            id: 'test-customer-id'
          }
        }
      } as any);

      const result = await createOrUpdateCustomer('John Doe', 'john@example.com');

      expect(result).toEqual({
        id: 'test-customer-id',
        name: 'John Doe',
        email: 'john@example.com'
      });
    });

    it('should update an existing customer', async () => {
      mockClient.customersApi.searchCustomers.mockResolvedValue({
        result: {
          customers: [{
            id: 'existing-customer-id'
          }]
        }
      } as any);

      const result = await createOrUpdateCustomer('John Doe', 'john@example.com');

      expect(mockClient.customersApi.updateCustomer).toHaveBeenCalledWith(
        'existing-customer-id',
        expect.any(Object)
      );
    });
  });

  describe('addCustomerToLeagueGroup', () => {
    it('should add customer to existing group', async () => {
      mockClient.customerGroupsApi.listCustomerGroups.mockResolvedValue({
        result: {
          groups: [{
            id: 'existing-group-id',
            name: 'Test League'
          }]
        }
      } as any);

      const result = await addCustomerToLeagueGroup('customer-id', 'Test League');

      expect(result).toBe('existing-group-id');
      expect(mockClient.customersApi.addGroupToCustomer).toHaveBeenCalledWith(
        'customer-id',
        'existing-group-id'
      );
    });

    it('should create new group if it does not exist', async () => {
      mockClient.customerGroupsApi.listCustomerGroups.mockResolvedValue({
        result: { groups: [] }
      } as any);

      mockClient.customerGroupsApi.createCustomerGroup.mockResolvedValue({
        result: {
          group: {
            id: 'new-group-id'
          }
        }
      } as any);

      const result = await addCustomerToLeagueGroup('customer-id', 'New League');

      expect(result).toBe('new-group-id');
    });
  });

  describe('enrollInLoyalty', () => {
    it('should enroll customer in loyalty program', async () => {
      mockClient.loyaltyApi.listLoyaltyPrograms.mockResolvedValue({
        result: {
          programs: [{
            id: 'loyalty-program-id'
          }]
        }
      } as any);

      mockClient.loyaltyApi.searchLoyaltyAccounts.mockResolvedValue({
        result: { loyaltyAccounts: [] }
      } as any);

      mockClient.loyaltyApi.createLoyaltyAccount.mockResolvedValue({
        result: {
          loyaltyAccount: {
            id: 'loyalty-account-id'
          }
        }
      } as any);

      const result = await enrollInLoyalty('customer-id');

      expect(result).toHaveProperty('id', 'loyalty-account-id');
    });
  });

  describe('processPayment', () => {
    it('should process payment successfully', async () => {
      mockClient.paymentsApi.createPayment.mockResolvedValue({
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
      } as any);

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
      mockClient.customersApi.searchCustomers.mockRejectedValue(
        new Error('API Error') as any
      );

      await expect(
        createOrUpdateCustomer('John Doe', 'john@example.com')
      ).rejects.toThrow('API Error');
    });
  });
});