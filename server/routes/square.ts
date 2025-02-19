import { Router } from 'express';
import { processPayment, createOrUpdateCustomer } from '../services/square.js';

const router = Router();

router.post('/payments', async (req, res) => {
  try {
    console.log('[Square Routes] Processing payment request:', {
      amount: req.body.amount,
      locationId: req.body.locationId,
      sourceIdPresent: !!req.body.sourceId
    });

    const payment = await processPayment(
      req.body.sourceId,
      req.body.amount,
      req.body.locationId
    );

    console.log('[Square Routes] Payment processed successfully:', {
      paymentId: payment.id,
      status: payment.status
    });

    res.json(payment);
  } catch (error) {
    console.error('[Square Routes] Payment processing error:', {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error
    });
    res.status(500).send(error instanceof Error ? error.message : 'Payment processing failed');
  }
});

router.post('/customers', async (req, res) => {
  try {
    console.log('[Square Routes] Creating/updating customer:', {
      name: req.body.name,
      email: req.body.email,
      teamId: req.body.teamId
    });

    const customer = await createOrUpdateCustomer(
      req.body.name,
      req.body.email
    );

    if (!customer) {
      throw new Error('Failed to create/update customer');
    }

    console.log('[Square Routes] Customer operation successful:', {
      customerId: customer.id,
      name: customer.name
    });

    res.json(customer);
  } catch (error) {
    console.error('[Square Routes] Customer operation error:', {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error
    });
    res.status(500).send(error instanceof Error ? error.message : 'Customer operation failed');
  }
});

export default router;
