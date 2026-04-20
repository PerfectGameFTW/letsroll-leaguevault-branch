/**
 * Public-facing client config for the payment SDKs.
 *
 * Routes:
 *  - GET /config
 */
import { Router } from 'express';
import { storage } from '../../storage';
import { createLogger } from '../../logger';
import { isDev } from '../../config';

const log = createLogger('Payments');

const router = Router();

router.get('/config', async (req: any, res) => {
  const locationIdParam = req.query.locationId as string | undefined;
  if (locationIdParam) {
    const lvLocationId = parseInt(locationIdParam);
    if (!isNaN(lvLocationId)) {
      try {
        const loc = await storage.getLocation(lvLocationId);
        if (loc) {
          const isAuthorized =
            req.user?.role === 'system_admin' ||
            (req.user?.organizationId != null && req.user.organizationId === loc.organizationId);
          if (isAuthorized) {
            if (loc.paymentProvider === 'cardpointe') {
              const cpCreds = await storage.getLocationCardPointeConfig(lvLocationId);
              if (cpCreds?.merchantId && cpCreds.merchantId.trim().length > 0 && cpCreds.siteUrl && cpCreds.siteUrl.trim().length > 0) {
                return res.json({
                  paymentProvider: 'cardpointe',
                  tokenizerUrl: `https://${cpCreds.siteUrl.replace(/^https?:\/\//, '')}/itoke/ajax-tokenizer.html`,
                });
              }
            }

            const creds = await storage.getLocationSquareConfig(lvLocationId);
            if (creds?.appId && creds?.accessToken && creds.appId.trim().length > 0) {
              return res.json({
                appId: creds.appId.trim(),
                locationId: creds.locationId?.trim() || '',
                paymentProvider: loc.paymentProvider ?? 'square',
              });
            }
          }
        }
      } catch {
        // fall through to env-var config
      }
    }
  }

  const prodAppId = process.env.SQUARE_PRODUCTION_APP_ID || '';
  const viteAppId = process.env.VITE_SQUARE_APP_ID || '';
  const squareAppId = process.env.SQUARE_APP_ID || '';

  const appId = prodAppId
    || ((viteAppId && !viteAppId.includes('sandbox-')) ? viteAppId : '')
    || ((squareAppId && !squareAppId.includes('sandbox-')) ? squareAppId : '')
    || viteAppId || squareAppId;

  if (isDev) log.info('Serving config:', {
    prodAppIdSet: !!prodAppId,
    viteAppIdSet: !!viteAppId,
    squareAppIdSet: !!squareAppId,
    selectedAppId: appId.substring(0, 10) + '...',
    isProduction: appId.length > 0 && !appId.includes('sandbox-'),
  });

  const squareLocationId = process.env.SQUARE_LOCATION_ID || process.env.VITE_SQUARE_LOCATION_ID || '';
  res.json({ appId, locationId: squareLocationId, paymentProvider: 'square' });
});

export default router;
