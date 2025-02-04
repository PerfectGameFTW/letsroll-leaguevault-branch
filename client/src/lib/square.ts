
import { loadScript } from "@/lib/utils";

declare global {
  interface Window {
    Square: any;
  }
}

let payments: any = null;

export async function initializeSquare() {
  if (!payments) {
    await loadScript("https://sandbox.web.squarecdn.com/v1/square.js");
    payments = await window.Square.payments(import.meta.env.VITE_SQUARE_APP_ID, import.meta.env.VITE_SQUARE_LOCATION_ID);
  }
  return payments;
}

export async function createPayment(amount: number) {
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
      }),
    });
    
    const payment = await response.json();
    return {
      id: payment.id,
      status: payment.status
    };
  }
  
  throw new Error(result.errors[0].message);
}
