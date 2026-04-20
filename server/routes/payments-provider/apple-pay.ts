/**
 * Apple Pay domain registration (single + bulk).
 *
 * Routes:
 *  - POST /apple-pay/register-all-domains
 *  - POST /apple-pay/register-domain
 */
import { Router } from 'express';
import { storage } from '../../storage';
import { sendSuccess, sendError } from '../../utils/api.js';
import { createLogger } from '../../logger';
import { getPaymentProvider, ProviderNotConfiguredError } from '../../services/payment-provider-factory';
import { hasWalletSupport } from '../../services/payment-provider';

const log = createLogger('Payments');

const router = Router();

router.post('/apple-pay/register-all-domains', async (req: any, res) => {
  try {
    if (req.user?.role !== 'system_admin') {
      return sendError(res, 'System admin access required', 403, 'FORBIDDEN');
    }

    const organizations = await storage.getOrganizations();
    const results: { domain: string; success: boolean; message: string }[] = [];

    for (const org of organizations) {
      const domain = org.subdomain || org.slug;
      if (!domain) continue;

      const fullDomain = `${domain}.leaguevault.app`;
      const orgLeagues = await storage.getLeagues(org.id);
      const locationIds = new Set<number>();
      for (const league of orgLeagues) {
        if (league.locationId) locationIds.add(league.locationId);
      }

      if (locationIds.size === 0) {
        results.push({ domain: fullDomain, success: false, message: 'No locations with payment credentials' });
        continue;
      }

      for (const locationId of locationIds) {
        try {
          const provider = await getPaymentProvider(locationId);
          if (hasWalletSupport(provider)) {
            const result = await provider.registerApplePayDomain(fullDomain);
            results.push({ domain: fullDomain, ...result });
          } else {
            results.push({ domain: fullDomain, success: false, message: 'Provider does not support Apple Pay' });
          }
        } catch (e) {
          if (e instanceof ProviderNotConfiguredError) {
            results.push({ domain: fullDomain, success: false, message: 'Payment provider not configured' });
          } else {
            throw e;
          }
        }
      }
    }

    const registered = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    log.info(`Apple Pay bulk registration: ${registered} succeeded, ${failed} failed`);
    sendSuccess(res, { results, registered, failed });
  } catch (error) {
    log.error('Apple Pay bulk registration error:', error);
    sendError(res, 'Failed to bulk register domains', 500);
  }
});

router.post('/apple-pay/register-domain', async (req: any, res) => {
  try {
    if (req.user?.role !== 'system_admin' && req.user?.role !== 'org_admin') {
      return sendError(res, 'Admin access required', 403, 'FORBIDDEN');
    }

    const { domain, locationId } = req.body;
    if (!domain || typeof domain !== 'string') {
      return sendError(res, 'Domain is required', 400, 'VALIDATION_ERROR');
    }

    if (req.user.role === 'org_admin' && req.user.organizationId) {
      const org = await storage.getOrganization(req.user.organizationId);
      if (org) {
        const orgDomain = org.subdomain || org.slug;
        const expectedDomain = `${orgDomain}.leaguevault.app`;
        if (domain !== expectedDomain) {
          return sendError(res, 'Domain does not match your organization', 403, 'FORBIDDEN');
        }
      }

      if (locationId) {
        const location = await storage.getLocation(parseInt(locationId));
        if (!location || location.organizationId !== req.user.organizationId) {
          return sendError(res, 'Location does not belong to your organization', 403, 'FORBIDDEN');
        }
      }
    }

    const lvLocationId = locationId ? parseInt(locationId) : null;
    let provider;
    try {
      provider = await getPaymentProvider(lvLocationId);
    } catch (e) {
      if (e instanceof ProviderNotConfiguredError) {
        return sendError(res, 'Payment provider not configured for this location', 422, 'PROVIDER_NOT_CONFIGURED');
      }
      throw e;
    }
    if (!hasWalletSupport(provider)) {
      return sendError(res, 'Payment provider does not support Apple Pay', 400, 'UNSUPPORTED_FEATURE');
    }

    const result = await provider.registerApplePayDomain(domain);

    if (result.success) {
      sendSuccess(res, result);
    } else {
      sendError(res, result.message, 400, 'REGISTRATION_FAILED');
    }
  } catch (error) {
    log.error('Apple Pay domain registration error:', error);
    sendError(res, 'Failed to register domain for Apple Pay', 500);
  }
});

export default router;
