import { loadScript } from "@/lib/utils";

declare global {
  interface Window {
    Square: any;
  }
}

let payments: any = null;

export async function initializeSquare() {
  if (!payments) {
    try {
      console.log("Loading Square.js script...");
      await loadScript("https://sandbox.web.squarecdn.com/v1/square.js");
      console.log("Square.js script loaded");

      if (!import.meta.env.VITE_SQUARE_APP_ID || !import.meta.env.VITE_SQUARE_LOCATION_ID) {
        throw new Error("Square credentials are not configured");
      }

      console.log("Initializing Square payments...");
      payments = await window.Square?.payments(
        import.meta.env.VITE_SQUARE_APP_ID,
        import.meta.env.VITE_SQUARE_LOCATION_ID
      );

      if (!payments) {
        throw new Error("Failed to initialize Square payments");
      }
      console.log("Square payments initialized successfully");
    } catch (error) {
      console.error("Square initialization error:", error);
      throw new Error("Failed to initialize Square payments. Please check your configuration.");
    }
  }
  return payments;
}

export async function createPayment(amount: number) {
  try {
    const payments = await initializeSquare();
    const card = await payments.card();
    await card.attach('#card-container');

    const result = await card.tokenize();
    if (result.status === 'OK') {
      const response = await fetch('/api/payments/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sourceId: result.token,
          amount,
          locationId: import.meta.env.VITE_SQUARE_LOCATION_ID,
        }),
      });

      if (!response.ok) {
        await card.destroy();
        const error = await response.text();
        throw new Error(error || 'Payment processing failed');
      }

      const payment = await response.json();
      await card.destroy();
      return {
        id: payment.id,
        status: payment.status
      };
    } else {
      await card.destroy();
      throw new Error(result.errors[0].message);
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('An unexpected error occurred while processing payment');
  }
}