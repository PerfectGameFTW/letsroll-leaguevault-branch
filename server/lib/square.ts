import { ApiError } from "square";
import { logger } from "../logger";
import { getSquareClientForLocation } from "../services/square";

interface CreatePaymentParams {
  amount: number;
  cardId: string;
  bowlerId: number;
  leagueId: number;
  locationId: number;
  buyerEmail?: string;
  customerId?: string;
}

export async function createSquarePayment({
  amount,
  cardId,
  bowlerId,
  leagueId,
  locationId,
  buyerEmail,
  customerId,
}: CreatePaymentParams) {
  try {
    const client = await getSquareClientForLocation(locationId);
    if (!client) {
      return {
        status: "error" as const,
        error: "Square is not configured for this location",
      };
    }

    const idempotencyKey = `${bowlerId}-${leagueId}-${Date.now()}`;

    logger.info(`Creating Square payment for location ${locationId}`, {
      amount,
      bowlerId,
      leagueId,
    });

    const payment = await client.paymentsApi.createPayment({
      sourceId: cardId,
      idempotencyKey,
      amountMoney: {
        amount: BigInt(amount),
        currency: "USD",
      },
      autocomplete: true,
      ...(buyerEmail && { buyerEmailAddress: buyerEmail }),
      ...(customerId && { customerId }),
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
