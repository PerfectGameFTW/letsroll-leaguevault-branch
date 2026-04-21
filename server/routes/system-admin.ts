import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { sendSuccess, sendError, sanitizeUser, handleZodError, handleUserOrgError } from '../utils/api.js';
import { storage } from '../storage';
import { db } from '../db';
import {
  countOrphanedRows,
  listOrphanedLeagues,
  listOrphanedTeams,
  listOrphanedBowlerLeagues,
  listOrphanedPayments,
  listOrphanedUsers,
  reassignOrphanedLeague,
  reassignOrphanedUser,
  deleteOrphanedLeague,
  deleteOrphanedTeam,
  deleteOrphanedBowlerLeague,
  deleteOrphanedPayment,
  deleteOrphanedUser,
  recordOrphanCleanupAudit,
  listOrphanCleanupAudits,
  NotOrphanedError,
  OrphanRowNotFoundError,
  type OrphanedResourceType,
} from '../storage/orphaned-data';
import { requireAdmin } from '../middleware/admin.js';
import { createLogger } from '../logger';
import { updateDeletionRequestStatusSchema, DELETION_REQUEST_STATUSES, type DeletionRequestStatus } from '@shared/schema';

const log = createLogger("SystemAdmin");

const router = Router();

router.post('/create/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(res, 'Invalid user ID', 400, 'INVALID_ID');
    }
    
    const user = await storage.getUser(userId);
    if (!user) {
      return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    }

    if (user.role === 'system_admin') {
      return sendError(res, 'User is already a system admin', 400, 'ALREADY_SYSTEM_ADMIN');
    }
    
    const updatedUser = await storage.updateUserRole(userId, 'system_admin');
    sendSuccess(res, sanitizeUser(updatedUser));
  } catch (error) {
    if (handleUserOrgError(res, error)) return;
    log.error('Error creating system admin:', error);
    sendError(res, 'Failed to create system admin', 500, 'SERVER_ERROR');
  }
});

router.get('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const users = await storage.getUsers();
    const systemAdmins = users.filter(user => user.role === 'system_admin');
    sendSuccess(res, systemAdmins.map(sanitizeUser));
  } catch (error) {
    log.error('Error fetching system admins:', error);
    sendError(res, 'Failed to fetch system admins', 500, 'SERVER_ERROR');
  }
});

router.post('/revoke/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(res, 'Invalid user ID', 400, 'INVALID_ID');
    }
    
    const user = await storage.getUser(userId);
    if (!user) {
      return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    }

    const users = await storage.getUsers();
    const systemAdmins = users.filter(u => u.role === 'system_admin');
    
    if (systemAdmins.length <= 1 && systemAdmins.some(admin => admin.id === userId)) {
      return sendError(res, 'Cannot revoke the last system admin', 400, 'LAST_SYSTEM_ADMIN');
    }

    if (req.user?.id === userId) {
      return sendError(res, 'Cannot revoke your own system admin access', 400, 'SELF_REVOKE_NOT_ALLOWED');
    }
    
    const updatedUser = await storage.updateUserRole(userId, 'user');
    sendSuccess(res, sanitizeUser(updatedUser));
  } catch (error) {
    if (handleUserOrgError(res, error)) return;
    log.error('Error revoking system admin:', error);
    sendError(res, 'Failed to revoke system admin privileges', 500, 'SERVER_ERROR');
  }
});

// Account deletion request management (system admin only)

// Lightweight count endpoint for the in-app sidebar badge. Polled
// frequently by the admin layout — keep it cheap (no row payload).
router.get('/deletion-requests/pending-count', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const count = await storage.countDeletionRequests({ status: 'pending' });
    sendSuccess(res, { count });
  } catch (error) {
    log.error('Error counting pending deletion requests:', error);
    sendError(res, 'Failed to count deletion requests', 500, 'SERVER_ERROR');
  }
});

router.get('/deletion-requests', requireAdmin, async (req: Request, res: Response) => {
  try {
    const statusParam = typeof req.query.status === 'string' ? req.query.status : undefined;
    const status = statusParam && (DELETION_REQUEST_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as DeletionRequestStatus)
      : undefined;
    const rows = await storage.listDeletionRequests(status ? { status } : undefined);
    sendSuccess(res, rows);
  } catch (error) {
    log.error('Error listing deletion requests:', error);
    sendError(res, 'Failed to list deletion requests', 500, 'SERVER_ERROR');
  }
});

router.patch('/deletion-requests/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return sendError(res, 'Invalid request ID', 400, 'INVALID_ID');
    }

    const parsed = updateDeletionRequestStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return handleZodError(res, parsed.error);
    }

    const existing = await storage.getDeletionRequest(id);
    if (!existing) {
      return sendError(res, 'Deletion request not found', 404, 'NOT_FOUND');
    }
    if (existing.status !== 'pending') {
      return sendError(res, 'Request has already been reviewed', 400, 'ALREADY_REVIEWED');
    }

    const reviewerId = req.user?.id;
    if (!reviewerId) {
      return sendError(res, 'Authentication required', 401, 'AUTH_REQUIRED');
    }

    const updated = await storage.updateDeletionRequestStatus(
      id,
      parsed.data.status,
      reviewerId,
      parsed.data.adminNote ?? null,
    );
    sendSuccess(res, updated);
  } catch (error) {
    log.error('Error updating deletion request:', error);
    sendError(res, 'Failed to update deletion request', 500, 'SERVER_ERROR');
  }
});

// Diagnostic endpoint: counts of org-less ("orphaned") rows per resource type.
// Per the access-control policy, normal CRUD paths deny access to rows with
// `organization_id IS NULL`. This endpoint is the explicit, opt-in admin tool
// that surfaces those rows so data-integrity issues are visible.
router.get('/orphaned-data-counts', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const counts = await countOrphanedRows();
    sendSuccess(res, counts);
  } catch (error) {
    log.error('Error counting orphaned rows:', error);
    sendError(res, 'Failed to count orphaned rows', 500, 'SERVER_ERROR');
  }
});

// Drill-down list endpoints for the data-integrity admin panel. Like the
// counts endpoint above, these are explicit "orphaned data" handlers that
// surface rows the regular CRUD paths intentionally hide.
const ORPHAN_TYPES: readonly OrphanedResourceType[] = [
  'leagues', 'teams', 'bowlerLeagues', 'payments', 'users',
] as const;

function parseOrphanType(raw: string): OrphanedResourceType | null {
  return (ORPHAN_TYPES as readonly string[]).includes(raw)
    ? (raw as OrphanedResourceType)
    : null;
}

router.get('/orphaned-data/:type', requireAdmin, async (req: Request, res: Response) => {
  const type = parseOrphanType(req.params.type);
  if (!type) return sendError(res, 'Invalid resource type', 400, 'INVALID_TYPE');
  try {
    const rows = await (
      type === 'leagues' ? listOrphanedLeagues() :
      type === 'teams' ? listOrphanedTeams() :
      type === 'bowlerLeagues' ? listOrphanedBowlerLeagues() :
      type === 'payments' ? listOrphanedPayments() :
      listOrphanedUsers()
    );
    sendSuccess(res, rows);
  } catch (error) {
    log.error(`Error listing orphaned ${type}:`, error);
    sendError(res, 'Failed to list orphaned rows', 500, 'SERVER_ERROR');
  }
});

const reassignBodySchema = z.object({
  organizationId: z.number().int().positive(),
});

function handleRepairError(res: Response, error: unknown, action: string, type: string) {
  if (error instanceof OrphanRowNotFoundError) {
    return sendError(res, error.message, 404, 'NOT_FOUND');
  }
  if (error instanceof NotOrphanedError) {
    return sendError(res, 'Row is not orphaned and cannot be repaired here', 409, 'NOT_ORPHANED');
  }
  log.error(`Error ${action} orphaned ${type}:`, error);
  sendError(res, `Failed to ${action} orphaned row`, 500, 'SERVER_ERROR');
}

router.post('/orphaned-data/:type/:id/reassign', requireAdmin, async (req: Request, res: Response) => {
  const type = parseOrphanType(req.params.type);
  if (!type) return sendError(res, 'Invalid resource type', 400, 'INVALID_TYPE');
  if (type !== 'leagues' && type !== 'users') {
    return sendError(res, 'Reassignment is only supported for leagues and users; child rows inherit their org from the parent league', 400, 'REASSIGN_UNSUPPORTED');
  }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return sendError(res, 'Invalid id', 400, 'INVALID_ID');
  const adminUserId = req.user?.id;
  if (!adminUserId) return sendError(res, 'Authentication required', 401, 'AUTH_REQUIRED');
  const parsed = reassignBodySchema.safeParse(req.body);
  if (!parsed.success) return handleZodError(res, parsed.error);
  try {
    await db.transaction(async (tx) => {
      if (type === 'leagues') {
        await reassignOrphanedLeague(id, parsed.data.organizationId, tx);
      } else {
        await reassignOrphanedUser(id, parsed.data.organizationId, tx);
      }
      await recordOrphanCleanupAudit(
        {
          adminUserId,
          resourceType: type,
          resourceId: id,
          action: 'reassign',
          organizationId: parsed.data.organizationId,
        },
        tx,
      );
    });
    sendSuccess(res, { id, organizationId: parsed.data.organizationId });
  } catch (error) {
    handleRepairError(res, error, 'reassign', type);
  }
});

router.post('/orphaned-data/:type/:id/delete', requireAdmin, async (req: Request, res: Response) => {
  const type = parseOrphanType(req.params.type);
  if (!type) return sendError(res, 'Invalid resource type', 400, 'INVALID_TYPE');
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return sendError(res, 'Invalid id', 400, 'INVALID_ID');
  const adminUserId = req.user?.id;
  if (!adminUserId) return sendError(res, 'Authentication required', 401, 'AUTH_REQUIRED');
  try {
    await db.transaction(async (tx) => {
      switch (type) {
        case 'leagues': await deleteOrphanedLeague(id, tx); break;
        case 'teams': await deleteOrphanedTeam(id, tx); break;
        case 'bowlerLeagues': await deleteOrphanedBowlerLeague(id, tx); break;
        case 'payments': await deleteOrphanedPayment(id, tx); break;
        case 'users': await deleteOrphanedUser(id, tx); break;
      }
      await recordOrphanCleanupAudit(
        {
          adminUserId,
          resourceType: type,
          resourceId: id,
          action: 'delete',
          organizationId: null,
        },
        tx,
      );
    });
    sendSuccess(res, { id, deleted: true });
  } catch (error) {
    handleRepairError(res, error, 'delete', type);
  }
});

// Recent activity feed for the data integrity admin panel.
router.get('/orphaned-data-audits', requireAdmin, async (req: Request, res: Response) => {
  try {
    const rawLimit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 50;
    const rows = await listOrphanCleanupAudits(limit);
    sendSuccess(res, rows);
  } catch (error) {
    log.error('Error listing orphan cleanup audits:', error);
    sendError(res, 'Failed to list orphan cleanup audits', 500, 'SERVER_ERROR');
  }
});

export default router;
