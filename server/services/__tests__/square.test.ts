import { jest } from '@jest/globals';
import {
  createOrUpdateCustomer,
  addCustomerToLeagueGroup,
  enrollInLoyalty,
  getLoyaltyPoints,
  processPayment
} from '../square';

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

type CustomerGroupResponse = ApiResponse<{
  group: {
    id: string;
    name?: string;
  };
}>;

type CustomerGroupsResponse = ApiResponse<{
  groups: Array<{
    id: string;
    name: string;
  }>;
}>;

type LoyaltyProgramResponse = ApiResponse<{
  programs: Array<{
    id: string;
  }>;
}>;

type LoyaltyAccountResponse = ApiResponse<{
  loyaltyAccount: {
    id: string;
  };
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

// Mock Square SDK
jest.mock('square', () => ({
  __esModule: true,
  Square: {
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
    (jest.requireMock('square') as any).Square.Client.mockImplementation(() => mockClient);
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

      mockClient.customersApi.searchCustomers.mockResolvedValue(searchResponse);
      mockClient.customersApi.createCustomer.mockResolvedValue(createResponse);

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

      mockClient.customersApi.searchCustomers.mockResolvedValue(searchResponse);

      const result = await createOrUpdateCustomer('John Doe', 'john@example.com');

      expect(mockClient.customersApi.updateCustomer).toHaveBeenCalledWith(
        'existing-customer-id',
        expect.any(Object)
      );
    });
  });

  describe('addCustomerToLeagueGroup', () => {
    it('should add customer to existing group', async () => {
      const groupsResponse: CustomerGroupsResponse = {
        result: {
          groups: [{
            id: 'existing-group-id',
            name: 'Test League'
          }]
        }
      };

      mockClient.customerGroupsApi.listCustomerGroups.mockResolvedValue(groupsResponse);

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
      } as CustomerGroupsResponse);

      mockClient.customerGroupsApi.createCustomerGroup.mockResolvedValue({
        result: {
          group: {
            id: 'new-group-id'
          }
        }
      } as CustomerGroupResponse);

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
      } as LoyaltyProgramResponse);

      mockClient.loyaltyApi.searchLoyaltyAccounts.mockResolvedValue({
        result: { loyaltyAccounts: [] }
      } as ApiResponse<{ loyaltyAccounts: any[] }>);

      mockClient.loyaltyApi.createLoyaltyAccount.mockResolvedValue({
        result: {
          loyaltyAccount: {
            id: 'loyalty-account-id'
          }
        }
      } as LoyaltyAccountResponse);

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
      mockClient.customersApi.searchCustomers.mockRejectedValue(
        new Error('API Error')
      );

      await expect(
        createOrUpdateCustomer('John Doe', 'john@example.com')
      ).rejects.toThrow('API Error');
    });
  });
});