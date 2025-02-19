import { Router } from 'express';
import { processPayment, createOrUpdateCustomer } from '../services/square.js';
import { sendSuccess, sendError } from '../utils/api.js';
import { z } from 'zod';

const router = Router();

const paymentSchema = z.object({
  sourceId: z.string().min(1, "Source ID is required"),
  amount: z.number().positive("Amount must be greater than 0"),
  locationId: z.string().min(1, "Location ID is required")
});

const customerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Valid email is required")
});

router.post('/payments', async (req, res) => {
  try {
    console.log('[Square Route] Processing payment request:', req.body);

    // Validate request body
    const validatedData = paymentSchema.parse(req.body);

    // Process payment
    const payment = await processPayment(
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

router.post('/customers', async (req, res) => {
  try {
    console.log('[Square Route] Creating/updating customer:', req.body);

    // Validate request body
    const validatedData = customerSchema.parse(req.body);

    // Create or update customer
    const customer = await createOrUpdateCustomer(
      validatedData.name,
      validatedData.email
    );

    console.log('[Square Route] Customer operation successful:', customer);
    sendSuccess(res, customer);
  } catch (error) {
    console.error('[Square Route] Customer operation error:', error);

    if (error instanceof z.ZodError) {
      return sendError(res, 'Invalid customer data: ' + error.errors[0].message, 400);
    }

    const errorMessage = error instanceof Error ? error.message : 'Failed to process customer operation';
    return sendError(res, errorMessage, 500);
  }
});

export default router;