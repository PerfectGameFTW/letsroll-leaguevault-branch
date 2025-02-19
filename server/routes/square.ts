import { Router } from 'express';
import squareService from '../services/square.js';
import { sendSuccess, sendError } from '../utils/api.js';
import { z } from 'zod';

const router = Router();

const paymentSchema = z.object({
  sourceId: z.string().min(1, "Source ID is required"),
  amount: z.number().positive("Amount must be greater than 0"),
  locationId: z.string().min(1, "Location ID is required")
});

router.post('/payments', async (req, res) => {
  try {
    console.log('[Square Route] Processing payment request:', req.body);

    // Validate request body
    const validatedData = paymentSchema.parse(req.body);

    // Process payment
    const payment = await squareService.processPayment(
      validatedData.sourceId,
      validatedData.amount,
      validatedData.locationId
    );

    console.log('[Square Route] Payment processed successfully:', payment);
    sendSuccess(res, payment);
  } catch (error) {
    console.error('[Square Route] Payment processing error:', error);

    if (error instanceof z.ZodError) {
      return sendError(res, 'Invalid payment data: ' + error.errors[0].message, 400);
    }

    // Handle Square API errors
    const errorMessage = error instanceof Error ? error.message : 'Failed to process payment';
    return sendError(res, errorMessage, 500);
  }
});

export default router;