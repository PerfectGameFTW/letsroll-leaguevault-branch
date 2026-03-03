import { ApiError, Client, Environment } from "square";
import { logger } from "../logger";

// Determine environment based on the access token format rather than NODE_ENV
// Production tokens start with "EAAAEv" while sandbox tokens start with "EAAAAv"
const token = process.env.SQUARE_ACCESS_TOKEN || '';
const appId = process.env.VITE_SQUARE_APP_ID || '';
const isProductionToken = !appId.includes('sandbox-') || token.startsWith('EAAAEv') || token.startsWith('EAAAl7');

// Log the detected environment for debugging
logger.info(`[Square] Initializing Square client with ${isProductionToken ? 'PRODUCTION' : 'SANDBOX'} environment`);
logger.info(`[Square] Token format check: ${isProductionToken ? 'PRODUCTION format detected' : 'SANDBOX format detected'}`);

const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: isProductionToken ? Environment.Production : Environment.Sandbox
});

interface CreatePaymentParams {
  amount: number;
  cardId: string;
  bowlerId: number;
  leagueId: number;
  buyerEmail?: string;
}

export async function createSquarePayment({
  amount,
  cardId,
  bowlerId,
  leagueId,
  buyerEmail,
}: CreatePaymentParams) {
  try {
    const idempotencyKey = `${bowlerId}-${leagueId}-${Date.now()}`;

    logger.info(`Creating Square payment in ${isProductionToken ? 'production' : 'sandbox'} mode`, {
      amount,
      bowlerId,
      leagueId,
      environment: isProductionToken ? 'production' : 'sandbox'
    });

    const payment = await squareClient.paymentsApi.createPayment({
      sourceId: cardId,
      idempotencyKey,
      amountMoney: {
        amount: BigInt(amount),
        currency: "USD",
      },
      autocomplete: true,
      ...(buyerEmail && { buyerEmailAddress: buyerEmail }),
    });

    if (payment.result?.payment?.id) {
      logger.info("Square payment created successfully", {
        paymentId: payment.result.payment.id,
        status: "success"
      });
      return {
        status: "success" as const,
        paymentId: payment.result.payment.id,
      };
    }

    throw new Error("Payment creation failed");
  } catch (error) {
    logger.error("Square payment creation failed:", error);

    if (error instanceof ApiError) {
      return {
        status: "error" as const,
        error: error.result.errors?.[0]?.detail || "Payment processing failed",
      };
    }

    return {
      status: "error" as const,
      error: error instanceof Error ? error.message : "Unknown payment error",
    };
  }
}