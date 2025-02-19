import { Router } from 'express';
import { processPayment } from '../services/square.js';
import { sendSuccess, sendError } from '../utils/api.js';

const router = Router();

router.post('/payments', async (req, res) => {
  try {
    console.log('[Square Route] Processing payment:', {
      sourceId: req.body.sourceId,
      amount: req.body.amount,
      locationId: req.body.locationId
    });

    const payment = await processPayment(
      req.body.sourceId,
      req.body.amount,
      req.body.locationId
    );

    console.log('[Square Route] Payment processed successfully:', payment);
    sendSuccess(res, payment);
  } catch (error) {
    console.error('[Square Route] Payment processing error:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to process payment');
  }
});

export default router;
