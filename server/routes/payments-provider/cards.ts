/**
 * Saved-card vault operations.
 *
 * Routes:
 *  - POST   /cards/:bowlerId
 *  - GET    /cards/:bowlerId
 *  - DELETE /cards/:bowlerId/:cardId
 */
import { Router } from 'express';
import { storage } from '../../storage';
import { sendSuccess, sendError } from '../../utils/api.js';
import { hasAccessToBowler } from '../../utils/access-control.js';
import { createLogger } from '../../logger';
import { getPaymentProvider, ProviderNotConfiguredError } from '../../services/payment-provider-factory';
import { getProviderCustomerId, persistCardpointeProfile } from '../../services/payment-utils';
import { getProviderForLeague } from './shared';

const log = createLogger('Payments');

const router = Router();

router.post('/cards/:bowlerId', async (req, res) => {
  try {
    const bowlerId = parseInt(req.params.bowlerId);
    if (isNaN(bowlerId)) return sendError(res, 'Invalid bowler ID', 400);

    if (!req.isAuthenticated()) {
      return sendError(res, 'Authentication required', 401, 'AUTH_REQUIRED');
    }

    if (!await hasAccessToBowler(req, bowlerId)) {
      return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
    }

    const { sourceId } = req.body;
    if (!sourceId || typeof sourceId !== 'string') {
      return sendError(res, 'sourceId is required', 400);
    }

    const bowler = await storage.getBowler(bowlerId);
    if (!bowler) {
      return sendError(res, 'Bowler not found', 404);
    }

    const cardLeagueId = req.body.leagueId ? parseInt(req.body.leagueId) : null;

    const provider = cardLeagueId
      ? await getProviderForLeague(cardLeagueId)
      : await getPaymentProvider(null);
    const providerCustId = getProviderCustomerId(bowler, provider);
    if (!providerCustId && provider.providerName !== 'cardpointe') {
      return sendError(res, 'Bowler does not have a payment customer account', 400);
    }

    const savedCard = await provider.saveCardOnFile(sourceId, providerCustId || '');
    if (!savedCard?.id) {
      return sendError(res, 'Failed to save card on file', 500);
    }

    log.info('Card saved on file (no-charge):', savedCard.id.substring(0, 15) + '...');
    await persistCardpointeProfile(provider, savedCard.id, bowlerId);
    return sendSuccess(res, { savedCardId: savedCard.id, last4: savedCard.last4, brand: savedCard.brand });
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) {
      return sendError(res, 'Payment provider not configured for this location', 422, 'PROVIDER_NOT_CONFIGURED');
    }
    log.error('Save card error:', error);
    return sendError(res, 'Failed to save card');
  }
});

router.get('/cards/:bowlerId', async (req, res) => {
  try {
    const bowlerId = parseInt(req.params.bowlerId);
    if (isNaN(bowlerId)) {
      return sendError(res, 'Invalid bowler ID', 400);
    }

    if (!await hasAccessToBowler(req, bowlerId)) {
      return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
    }

    const bowler = await storage.getBowler(bowlerId);
    if (!bowler) {
      return sendSuccess(res, []);
    }

    const listLeagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : null;
    let resolvedLeagueId = listLeagueId;
    if (!resolvedLeagueId) {
      const bowlerLeagues = await storage.getBowlerLeagues({ bowlerId: bowlerId });
      if (bowlerLeagues.length > 0) {
        resolvedLeagueId = bowlerLeagues[0].leagueId;
      }
    }

    let provider;
    try {
      provider = resolvedLeagueId
        ? await getProviderForLeague(resolvedLeagueId)
        : await getPaymentProvider(null);
    } catch (e) {
      if (e instanceof ProviderNotConfiguredError) {
        log.warn('List cards: provider not configured, returning empty', { leagueId: resolvedLeagueId });
        return sendSuccess(res, []);
      }
      throw e;
    }

    const providerCustId = getProviderCustomerId(bowler, provider);
    if (!providerCustId) {
      return sendSuccess(res, []);
    }

    const cards = await provider.listCardsOnFile(providerCustId);
    sendSuccess(res, cards);
  } catch (error) {
    log.error('List cards error:', error);
    sendError(res, 'Failed to list cards');
  }
});

router.delete('/cards/:bowlerId/:cardId', async (req, res) => {
  try {
    const bowlerId = parseInt(req.params.bowlerId);
    if (isNaN(bowlerId)) {
      return sendError(res, 'Invalid bowler ID', 400);
    }

    const { cardId } = req.params;
    if (!cardId || typeof cardId !== 'string') {
      return sendError(res, 'Invalid card ID', 400);
    }

    if (!await hasAccessToBowler(req, bowlerId)) {
      return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
    }

    const bowler = await storage.getBowler(bowlerId);
    if (!bowler) {
      return sendError(res, 'Bowler not found', 404);
    }

    const delLeagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : null;
    let resolvedLeagueId = delLeagueId;
    if (!resolvedLeagueId) {
      const bowlerLeagues = await storage.getBowlerLeagues({ bowlerId: bowlerId });
      if (bowlerLeagues.length > 0) {
        resolvedLeagueId = bowlerLeagues[0].leagueId;
      }
    }

    const provider = resolvedLeagueId
      ? await getProviderForLeague(resolvedLeagueId)
      : await getPaymentProvider(null);

    const providerCustId = getProviderCustomerId(bowler, provider);
    if (!providerCustId) {
      return sendError(res, 'Bowler does not have a payment customer account', 400);
    }

    await provider.disableCard(cardId, providerCustId);
    log.info('Card disabled:', cardId.substring(0, 15) + '...');
    sendSuccess(res, { disabled: true });
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) {
      return sendError(res, 'Payment provider not configured for this location', 422, 'PROVIDER_NOT_CONFIGURED');
    }
    const message = error instanceof Error ? error.message : 'Failed to remove card';
    log.error('Disable card error:', message);
    sendError(res, message, message.includes('does not belong') ? 403 : 500);
  }
});

export default router;
