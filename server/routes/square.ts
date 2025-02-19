import { Router } from 'express';
import { processPayment } from '../services/square.js';
import { sendSuccess, sendError } from '../utils/api.js';
import { z } from 'zod';

const router = Router();

// Payment request validation schema
const paymentSchema = z.object({
  sourceId: z.string(),
  amount: z.number().int().positive(),
  locationId: z.string()
});

router.post('/payments', async (req, res) => {
  try {
    console.log('[Square Route] Processing payment request:', {
      ...req.body,
      sourceId: req.body.sourceId ? '[REDACTED]' : undefined
    });

    // Validate request body
    const validatedData = paymentSchema.parse(req.body);

    const payment = await processPayment(
      validatedData.sourceId,
      validatedData.amount,
      validatedData.locationId
    );

    console.log('[Square Route] Payment processed successfully:', {
      id: payment.id,
      status: payment.status
    });

    sendSuccess(res, payment);
  } catch (error) {
    console.error('[Square Route] Payment processing error:', error);

    if (error instanceof z.ZodError) {
      sendError(res, 'Invalid payment data provided', 400, 'VALIDATION_ERROR');
    } else {
      const errorMessage = error instanceof Error ? error.message : 'Failed to process payment';
      const statusCode = error.statusCode || 500;
      sendError(res, errorMessage, statusCode);
    }
  }
});

export default router;