import { Router, Request, Response } from 'express';
import { sendSuccess, sendError, handleZodError, parseOptionalIntParam } from '../utils/api.js';
import { storage } from '../storage';
import type { OrgIntegrations } from '@shared/schema';
import { z } from 'zod';
import { createLogger } from '../logger';

const log = createLogger("Integrations");

const router = Router();

router.use((req: Request, res: Response, next) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return sendError(res, 'Authentication required', 401, 'UNAUTHORIZED');
  }
  if (req.user?.role !== 'system_admin' && req.user?.role !== 'org_admin') {
    return sendError(res, 'Admin access required', 403, 'FORBIDDEN');
  }
  next();
});

// task #421: tagged-union return so the caller can distinguish a
// genuinely-missing org (→ 400 'No organization context') from a
// caller who SENT something but it was malformed (→ 400 'Invalid
// organization ID format'). The previous `parseInt + ||` chain
// silently fell back to the caller's session org when a system
// admin's `?organizationId=foo` produced NaN, hiding the bad input.
type ResolveOrgResult =
  | { kind: 'ok'; orgId: number | null }
  | { kind: 'invalid' };

function resolveOrgId(req: Request): ResolveOrgResult {
  const isSystemAdmin = req.user?.role === 'system_admin';

  if (!isSystemAdmin) {
    return { kind: 'ok', orgId: req.user?.organizationId ?? null };
  }

  const fromQuery = parseOptionalIntParam(req.query?.organizationId);
  if (fromQuery === null) return { kind: 'invalid' };

  // The body may already be a JSON number (e.g. PATCH); only run the
  // string parser on string inputs. Non-integer numbers and any other
  // shape are rejected the same way a malformed query would be.
  const bodyOrgIdRaw = (req.body as { organizationId?: unknown } | undefined)?.organizationId;
  let fromBody: number | undefined;
  if (bodyOrgIdRaw !== undefined && bodyOrgIdRaw !== null && bodyOrgIdRaw !== '') {
    if (typeof bodyOrgIdRaw === 'number') {
      if (!Number.isInteger(bodyOrgIdRaw)) return { kind: 'invalid' };
      fromBody = bodyOrgIdRaw;
    } else if (typeof bodyOrgIdRaw === 'string') {
      const parsed = parseOptionalIntParam(bodyOrgIdRaw);
      if (parsed === null) return { kind: 'invalid' };
      fromBody = parsed;
    } else {
      return { kind: 'invalid' };
    }
  }

  const resolved = fromQuery ?? fromBody ?? req.user?.organizationId;
  return { kind: 'ok', orgId: resolved ?? null };
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const result = resolveOrgId(req);
    if (result.kind === 'invalid') {
      return sendError(res, 'Invalid organization ID format', 400);
    }
    const orgId = result.orgId;
    if (!orgId) {
      return sendError(res, 'No organization context', 400, 'BAD_REQUEST');
    }

    const integrations = await storage.getOrgIntegrations(orgId);

    const response = {
      bowlnow: {
        enabled: integrations?.bowlnow?.enabled ?? false,
        apiKeyConfigured: !!integrations?.bowlnow?.apiKey,
        locationId: integrations?.bowlnow?.locationId ?? '',
      },
    };

    sendSuccess(res, response);
  } catch (error) {
    log.error('Error fetching integrations:', error);
    sendError(res, 'Failed to fetch integrations');
  }
});

const updateIntegrationsSchema = z.object({
  organizationId: z.number().int().positive().optional(),
  bowlnow: z.object({
    enabled: z.boolean(),
    apiKey: z.string().optional(),
    locationId: z.string().optional(),
    // Optional per-org overrides for the BowlNow custom-field IDs
    // (task #478). Each is an opaque ID copied from the BowlNow
    // dashboard. The PATCH merge below preserves any prior value
    // when omitted from the request body — the existing settings
    // form sends only the legacy fields and we MUST NOT wipe these
    // on a routine settings save.
    leagueNameFieldId: z.string().optional(),
    leagueSeasonFieldId: z.string().optional(),
  }).optional(),
});

router.patch('/', async (req: Request, res: Response) => {
  try {
    const result = resolveOrgId(req);
    if (result.kind === 'invalid') {
      return sendError(res, 'Invalid organization ID format', 400);
    }
    const orgId = result.orgId;
    if (!orgId) {
      return sendError(res, 'No organization context', 400, 'BAD_REQUEST');
    }

    const parsed = updateIntegrationsSchema.safeParse(req.body);
    if (!parsed.success) {
      return handleZodError(res, parsed.error);
    }

    const existing = await storage.getOrgIntegrations(orgId);
    const updated: OrgIntegrations = { ...existing };

    if (parsed.data.bowlnow !== undefined) {
      const incoming = parsed.data.bowlnow;
      const resolvedApiKey = (incoming.apiKey !== undefined && incoming.apiKey !== '')
        ? incoming.apiKey
        : existing?.bowlnow?.apiKey;

      if (incoming.enabled && !resolvedApiKey) {
        return sendError(res, 'An API key is required to enable BowlNow', 400, 'VALIDATION_ERROR');
      }

      updated.bowlnow = {
        enabled: incoming.enabled,
        apiKey: resolvedApiKey,
        locationId: incoming.locationId !== undefined
          ? incoming.locationId
          : existing?.bowlnow?.locationId,
        // Preserve any previously-stored custom field IDs when the
        // request body omits them (task #478) — the legacy settings
        // form has no input for these yet, so a routine save would
        // otherwise silently disable league/season tag writes for
        // the org. Explicit empty string from the body clears it.
        leagueNameFieldId: incoming.leagueNameFieldId !== undefined
          ? (incoming.leagueNameFieldId || undefined)
          : existing?.bowlnow?.leagueNameFieldId,
        leagueSeasonFieldId: incoming.leagueSeasonFieldId !== undefined
          ? (incoming.leagueSeasonFieldId || undefined)
          : existing?.bowlnow?.leagueSeasonFieldId,
      };
    }

    await storage.updateOrgIntegrations(orgId, updated);

    const response = {
      bowlnow: {
        enabled: updated.bowlnow?.enabled ?? false,
        apiKeyConfigured: !!updated.bowlnow?.apiKey,
        locationId: updated.bowlnow?.locationId ?? '',
        leagueNameFieldId: updated.bowlnow?.leagueNameFieldId ?? '',
        leagueSeasonFieldId: updated.bowlnow?.leagueSeasonFieldId ?? '',
      },
    };

    sendSuccess(res, response);
  } catch (error) {
    log.error('Error updating integrations:', error);
    sendError(res, 'Failed to update integrations');
  }
});

export default router;
