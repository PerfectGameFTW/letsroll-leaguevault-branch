import { logger } from "../logger";
import { getPaymentProvider } from "../services/payment-provider-factory";

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
    const provider = await getPaymentProvider(locationId);
    if (!provider) {
      return {
        status: "error" as const,
        error: "Payment provider is not configured for this location",
      };
    }

    logger.info(`Creating payment for location ${locationId}`, {
      amount,
      bowlerId,
      leagueId,
      provider: provider.providerName,
    });

    const result = await provider.processPayment(
      cardId,
      amount,
      false,
      customerId,
      buyerEmail,
    );

    if (result?.id) {
      logger.info("Payment created successfully", {
        paymentId: result.id,
        status: "success"
      });
      return {
        status: "success" as const,
        paymentId: result.id,
      };
    }

    throw new Error("Payment creation failed");
  } catch (error) {
    logger.error("Payment creation failed:", error);

    return {
      status: "error" as const,
      error: error instanceof Error ? error.message : "Unknown payment error",
    };
  }
}
