import { ApiError, Client, Environment } from "square";
import { logger } from "../logger";

const token = (process.env.SQUARE_PRODUCTION_ACCESS_TOKEN || process.env.SQUARE_ACCESS_TOKEN || '').replace(/[^\x20-\x7E]/g, '').trim();
const prodAppId = process.env.SQUARE_PRODUCTION_APP_ID || '';
const viteAppId = process.env.VITE_SQUARE_APP_ID || '';
const squareAppId = process.env.SQUARE_APP_ID || '';
const appId = prodAppId
  || ((viteAppId && !viteAppId.includes('sandbox-')) ? viteAppId : '')
  || ((squareAppId && !squareAppId.includes('sandbox-')) ? squareAppId : '')
  || viteAppId || squareAppId;
const isProductionToken = token.startsWith('EAAAEv') || token.startsWith('EAAAl7');
const isProductionAppId = appId.length > 0 && !appId.includes('sandbox-');
const isProduction = isProductionAppId;

logger.info(`[Square] Initializing Square client with ${isProduction ? 'PRODUCTION' : 'SANDBOX'} environment`);
logger.info(`[Square] App ID format: ${isProductionAppId ? 'PRODUCTION' : 'SANDBOX'}, Token format: ${isProductionToken ? 'PRODUCTION' : 'SANDBOX'}`);
logger.info(`[Square] Token source: ${process.env.SQUARE_PRODUCTION_ACCESS_TOKEN ? 'SQUARE_PRODUCTION_ACCESS_TOKEN' : 'SQUARE_ACCESS_TOKEN'}`);

const squareClient = new Client({
  accessToken: token,
  environment: isProduction ? Environment.Production : Environment.Sandbox
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

    logger.info(`Creating Square payment in ${isProduction ? 'production' : 'sandbox'} mode`, {
      amount,
      bowlerId,
      leagueId,
      environment: isProduction ? 'production' : 'sandbox'
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