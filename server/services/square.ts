import { ApiError, Client, Environment } from 'square';

let squareClient: Client | null = null;
if (process.env.SQUARE_ACCESS_TOKEN) {
  squareClient = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: 'sandbox' as Environment,
  });
}

interface SquareCustomer {
  id: string;
  name: string;
  email: string;
}

export async function createOrUpdateCustomer(name: string, email: string): Promise<SquareCustomer | null> {
  if (!squareClient) return null;

  try {
    // Search for existing customer by email
    const searchResponse = await squareClient.customersApi.searchCustomers({
      query: {
        filter: {
          emailAddress: {
            exact: email.toLowerCase()
          }
        }
      }
    });

    let customerId: string;

    // If customer exists, update their details
    if (searchResponse.result.customers?.[0]?.id) {
      customerId = searchResponse.result.customers[0].id;
      await squareClient.customersApi.updateCustomer(customerId, {
        givenName: name.split(' ')[0],
        familyName: name.split(' ').slice(1).join(' ') || '',
        emailAddress: email.toLowerCase(),
      });
    } else {
      // Create new customer if none exists
      const customerResponse = await squareClient.customersApi.createCustomer({
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
    console.error('Square customer operation error:', error);
    throw error;
  }
}

export async function addCustomerToLeagueGroup(customerId: string, leagueName: string): Promise<string | null> {
  if (!squareClient) return null;

  try {
    // First try to find if the league group already exists
    const groupsResponse = await squareClient.customerGroupsApi.listCustomerGroups();
    const existingGroup = groupsResponse.result.groups?.find(
      (g) => g.name === leagueName
    );

    let groupId: string;

    if (existingGroup?.id) {
      groupId = existingGroup.id;
    } else {
      // Create new group if it doesn't exist
      const groupResponse = await squareClient.customerGroupsApi.createCustomerGroup({
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
    await squareClient.customersApi.addGroupToCustomer(customerId, groupId);

    return groupId;
  } catch (error) {
    console.error('Error managing customer group:', error);
    throw error;
  }
}

export async function enrollInLoyalty(customerId: string): Promise<any> {
  if (!squareClient) {
    throw new Error("Square access token not configured");
  }

  // First, check if a loyalty program exists
  const programResponse = await squareClient.loyaltyApi.listLoyaltyPrograms();

  if (!programResponse.result.programs || programResponse.result.programs.length === 0) {
    throw new Error("No loyalty program found. Please set up a loyalty program in Square Dashboard first.");
  }

  const programId = programResponse.result.programs[0].id;
  if (!programId) {
    throw new Error("Invalid loyalty program configuration");
  }

  // Check if customer is already enrolled
  const searchResponse = await squareClient.loyaltyApi.searchLoyaltyAccounts({
    query: {
      customerIds: [customerId]
    }
  });

  if (searchResponse.result.loyaltyAccounts && searchResponse.result.loyaltyAccounts.length > 0) {
    return searchResponse.result.loyaltyAccounts[0];
  }

  // Enroll the customer in the loyalty program
  const enrollResponse = await squareClient.loyaltyApi.createLoyaltyAccount({
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
  if (!squareClient) {
    throw new Error("Square access token not configured");
  }

  // Search for customer's loyalty account
  const searchResponse = await squareClient.loyaltyApi.searchLoyaltyAccounts({
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
  if (!squareClient) {
    throw new Error("Square access token not configured");
  }

  try {
    const response = await squareClient.paymentsApi.createPayment({
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