import { Router } from 'express';
import { processPayment, createOrUpdateCustomer } from '../services/square.js';
import { storage } from '../storage.js';

const router = Router();

router.post('/payments', async (req, res) => {
  try {
    console.log('[Square Routes] Processing payment request:', {
      amount: req.body.amount,
      sourceIdPresent: !!req.body.sourceId
    });

    const payment = await processPayment(
      req.body.sourceId,
      req.body.amount
    );

    console.log('[Square Routes] Payment processed successfully:', {
      paymentId: payment.id,
      status: payment.status
    });

    // Save payment record to database
    const dbPayment = await storage.createPayment({
      bowlerId: req.body.bowlerId,
      leagueId: req.body.leagueId,
      amount: req.body.amount,
      weekOf: new Date(),
      status: 'paid',
      type: 'credit_card',
      squarePaymentId: payment.id
    });

    console.log('[Square Routes] Payment record created in database:', {
      paymentId: dbPayment.id,
      squarePaymentId: payment.id
    });

    res.json({
      ...payment,
      dbPaymentId: dbPayment.id
    });
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