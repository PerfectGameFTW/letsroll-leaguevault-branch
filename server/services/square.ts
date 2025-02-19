import { ApiError, Client, Environment } from '@square/web-sdk';

interface SquareCustomer {
  id: string;
  name: string;
  email: string;
}

// Initialize Square client with enhanced error handling
let squareClient: Client | null = null;

async function initializeSquareClient() {
  if (!squareClient && process.env.SQUARE_ACCESS_TOKEN) {
    try {
      console.log('[Square Service] Initializing Square client...');
      squareClient = new Client({
        accessToken: process.env.SQUARE_ACCESS_TOKEN,
        environment: Environment.Sandbox,
        userAgentDetail: 'bowling-league-app',
        timeout: 30000,
      });
      console.log('[Square Service] Square client initialized successfully');
    } catch (error) {
      console.error('[Square Service] Failed to initialize Square client:', error);
      throw error;
    }
  }
  return squareClient;
}

export async function createOrUpdateCustomer(name: string, email: string): Promise<SquareCustomer | null> {
  const client = await initializeSquareClient();
  if (!client) return null;

  try {
    const searchResponse = await client.customersApi.searchCustomers({
      query: {
        filter: {
          emailAddress: {
            exact: email.toLowerCase()
          }
        }
      }
    });

    let customerId;

    if (searchResponse.result.customers?.[0]?.id) {
      customerId = searchResponse.result.customers[0].id;
      await client.customersApi.updateCustomer(customerId, {
        givenName: name.split(' ')[0],
        familyName: name.split(' ').slice(1).join(' ') || '',
        emailAddress: email.toLowerCase(),
      });
    } else {
      const customerResponse = await client.customersApi.createCustomer({
        idempotencyKey: `${Date.now()}-${Math.random()}`,
        givenName: name.split(' ')[0],
        familyName: name.split(' ').slice(1).join(' ') || '',
        emailAddress: email.toLowerCase(),
      });

      if (!customerResponse.result?.customer?.id) {
        throw new Error('Failed to create Square customer');
      }

      customerId = customerResponse.result.customer.id;
    }

    return {
      id: customerId,
      name,
      email
    };
  } catch (error) {
    console.error('Square customer operation error:', error instanceof Error ? error.message : error);
    throw error;
  }
}

export async function addCustomerToLeagueGroup(customerId: string, leagueName: string): Promise<string | null> {
  const client = await initializeSquareClient();
  if (!client) return null;

  try {
    // First try to find if the league group already exists
    const groupsResponse = await client.customerGroupsApi.listCustomerGroups();
    const existingGroup = groupsResponse.result.groups?.find((g: { name: string; id: string }) => g.name === leagueName);

    let groupId: string;

    if (existingGroup?.id) {
      groupId = existingGroup.id;
    } else {
      // Create new group if it doesn't exist
      const groupResponse = await client.customerGroupsApi.createCustomerGroup({
        idempotencyKey: `league-${leagueName}`,
        group: {
          name: leagueName,
        },
      });

      if (!groupResponse.result.group?.id) {
        throw new Error("Failed to create league group");
      }

      groupId = groupResponse.result.group.id;
    }

    // Add customer to group using the correct API method
    await client.customersApi.addGroupToCustomer(customerId, groupId);

    return groupId;
  } catch (error) {
    console.error('Error managing customer group:', error);
    throw error;
  }
}

export async function enrollInLoyalty(customerId: string): Promise<any> {
  const client = await initializeSquareClient();
  if (!client) {
    throw new Error("Square access token not configured");
  }

  const programResponse = await client.loyaltyApi.listLoyaltyPrograms();

  if (!programResponse.result.programs || programResponse.result.programs.length === 0) {
    throw new Error("No loyalty program found. Please set up a loyalty program in Square Dashboard first.");
  }

  const programId = programResponse.result.programs[0].id;
  if (!programId) {
    throw new Error("Invalid loyalty program configuration");
  }

  const searchResponse = await client.loyaltyApi.searchLoyaltyAccounts({
    query: {
      customerIds: [customerId]
    }
  });

  if (searchResponse.result.loyaltyAccounts && searchResponse.result.loyaltyAccounts.length > 0) {
    return searchResponse.result.loyaltyAccounts[0];
  }

  const enrollResponse = await client.loyaltyApi.createLoyaltyAccount({
    loyaltyAccount: {
      programId,
      customerId,
    },
    idempotencyKey: `${Date.now()}-${Math.random()}`
  });

  if (!enrollResponse.result.loyaltyAccount) {
    throw new Error("Failed to create loyalty account");
  }

  return enrollResponse.result.loyaltyAccount;
}

export async function getLoyaltyPoints(customerId: string): Promise<{
  points: number;
  lifetimePoints: number;
  enrolledAt: string;
}> {
  const client = await initializeSquareClient();
  if (!client) {
    throw new Error("Square access token not configured");
  }

  const searchResponse = await client.loyaltyApi.searchLoyaltyAccounts({
    query: {
      customerIds: [customerId]
    }
  });

  if (!searchResponse.result.loyaltyAccounts || searchResponse.result.loyaltyAccounts.length === 0) {
    throw new Error("Customer is not enrolled in loyalty program");
  }

  const loyaltyAccount = searchResponse.result.loyaltyAccounts[0];

  return {
    points: loyaltyAccount.balance ?? 0,
    lifetimePoints: loyaltyAccount.lifetimePoints ?? 0,
    enrolledAt: loyaltyAccount.createdAt ?? new Date().toISOString(),
  };
}

export async function processPayment(sourceId: string, amount: number, locationId: string): Promise<{
  id: string;
  status: string;
  card: {
    last4: string;
    brand: string;
  };
}> {
  const client = await initializeSquareClient();
  if (!client) {
    throw new Error("Square access token not configured");
  }

  try {
    const response = await client.paymentsApi.createPayment({
      sourceId,
      idempotencyKey: `${Date.now()}-${Math.random()}`,
      amountMoney: {
        amount: BigInt(amount),
        currency: 'USD'
      },
      locationId,
    });

    if (!response.result.payment) {
      throw new Error("Payment creation failed");
    }

    const payment = response.result.payment;

    return {
      id: payment.id ?? '',
      status: payment.status ?? 'UNKNOWN',
      card: {
        last4: payment.cardDetails?.card?.last4 ?? '****',
        brand: payment.cardDetails?.card?.cardBrand ?? 'UNKNOWN'
      }
    };
  } catch (error) {
    console.error('Payment processing error:', error);
    throw error;
  }
}

export default {
  createOrUpdateCustomer,
  addCustomerToLeagueGroup,
  enrollInLoyalty,
  getLoyaltyPoints,
  processPayment
};