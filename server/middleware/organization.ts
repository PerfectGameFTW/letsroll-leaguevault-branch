import { Request, Response, NextFunction } from 'express';
import { storage } from '../storage';
import { sendError } from '../utils/api.js';
import { createLogger } from '../logger';

const log = createLogger("OrgMiddleware");

/**
 * Middleware to ensure a user can only access resources from their organization
 * This middleware should be used after the authentication middleware
 */
export function requireOrganizationAccess(req: any, res: Response, next: NextFunction) {
  // If the user is not authenticated, deny access
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return sendError(
      res,
      'Authentication required',
      401,
      'AUTH_REQUIRED'
    );
  }

  // If the user doesn't have an organization, they can only access unassigned resources
  if (!req.user.organizationId) {
    // Set a flag indicating this user can only access unassigned resources
    req.organizationFilter = null;
    return next();
  }

  // The user has an organization, set the filter to their organization
  req.organizationFilter = req.user.organizationId;
  next();
}

/**
 * Middleware to filter resources by the user's organization
 * This automatically adds the organization filter to the request
 */
export function filterByOrganization(req: any, res: Response, next: NextFunction) {
  // If the user is not authenticated, don't apply any filter
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    req.organizationFilter = null;
    return next();
  }

  // System admins without an organization see all data
  // System admins with an organization default to their org's data
  if (req.user.role === 'system_admin' && !req.query.organizationId) {
    req.organizationFilter = req.user.organizationId || null;
    return next();
  }

  // If a specific organization is requested in the query string
  if (req.query.organizationId) {
    const orgId = parseInt(req.query.organizationId);

    // System admins can access any organization
    if (req.user.role === 'system_admin') {
      req.organizationFilter = orgId;
      return next();
    }

    // Organization admins can only access their own organization
    if (req.user.organizationId === orgId) {
      req.organizationFilter = orgId;
      return next();
    }

    // User requested an organization they don't have access to
    return sendError(
      res,
      'You do not have access to this organization',
      403,
      'ORG_ACCESS_DENIED'
    );
  }

  // Default to the user's organization
  req.organizationFilter = req.user.organizationId;
  next();
}

/**
 * Middleware to check if a league belongs to the user's organization
 */
export async function hasAccessToLeague(req: any, leagueId: number): Promise<boolean> {
  if (!req.user) {
    return false;
  }

  // Get the league
  const league = await storage.getLeague(leagueId);
  if (!league) {
    return false;
  }

  // Org-less resource policy (see server/utils/access-control.ts): deny for
  // every role, including system_admin, before any role-based bypass.
  if (league.organizationId === null) {
    log.warn(`league ${leagueId} has no organization — denying access to user ${req.user.id} (role=${req.user.role})`);
    return false;
  }

  // System admins have access to all org-scoped leagues
  if (req.user.role === 'system_admin') {
    return true;
  }

  // User can access leagues from their organization
  return league.organizationId === req.user.organizationId;
}

/**
 * Extract organization ID from request
 * This utility function gets the organization ID from the request
 * accounting for user permissions and query parameters
 */
export function getOrganizationFilter(req: any): number | null {
  // If organization filter was already determined, use it
  if (req.organizationFilter !== undefined) {
    return req.organizationFilter;
  }

  // System admins default to their org, or all if unassigned
  if (req.user && req.user.role === 'system_admin' && !req.query.organizationId) {
    return req.user.organizationId || null;
  }

  // If query has organization ID, validate access
  if (req.query.organizationId) {
    const orgId = parseInt(req.query.organizationId);
    
    // System admins can access any organization
    if (req.user && req.user.role === 'system_admin') {
      return orgId;
    }
    
    // Organization admins can only access their own organization
    if (req.user && req.user.organizationId === orgId) {
      return orgId;
    }
    
    // User doesn't have access to requested organization
    // Default to their own
    return req.user ? req.user.organizationId : null;
  }

  // Default to user's organization if authenticated
  return req.user ? req.user.organizationId : null;
}