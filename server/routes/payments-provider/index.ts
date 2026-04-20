/**
 * Payment provider router (mounted at /api/payments-provider).
 *
 * Owns the **execution side** of payments: charging the payment provider
 * (Square / CardPointe), customer create/update, catalog, card vault, wallet
 * domain registration, and idempotent payment recording for live charges.
 *
 * For straight DB CRUD over the payments table (list/update/delete/refund),
 * see `../payments.ts` mounted at /api/payments.
 *
 * This file is a thin composition module: each concern lives in its own
 * sub-router under this folder and is mounted onto the same root router so
 * the public `/api/payments-provider/*` URL surface is unchanged.
 */
import { Router } from 'express';
import { requireAuthenticated } from './shared';
import chargesRouter from './charges';
import customersRouter from './customers';
import catalogRouter from './catalog';
import cardsRouter from './cards';
import applePayRouter from './apple-pay';
import configRouter from './config';

const router = Router();

router.use(requireAuthenticated);

router.use(chargesRouter);
router.use(customersRouter);
router.use(catalogRouter);
router.use(cardsRouter);
router.use(applePayRouter);
router.use(configRouter);

export default router;
