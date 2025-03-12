import { Request, Response, NextFunction } from 'express';
import { storage } from '../storage';
import { sendError } from '../utils/api';

/**
 * Middleware to ensure a user can only access resources from their organization
 * This middleware should be used after the authentication middleware
 */
export function requireOrganizationAccess(req: any, res: Response, next: NextFunction) {
  // Check if user is authenticated
  if (!req.isAuthenticated() || !req.user) {
    return sendError(res, 'Authentication required', 401, 'Unauthorized');
  }

  // System admins can access all organizations
  if (req.user.isAdmin) {
    return next();
  }

  // Get the requested organization ID from the URL parameters
  const organizationId = req.params.organizationId || req.query.organizationId;
  
  // If no organization ID is provided, pass through (the route handler will handle filtering)
  if (!organizationId) {
    return next();
  }

  const orgId = parseInt(organizationId.toString(), 10);
  
  // Check if the user belongs to the requested organization
  // Convert organizationId to string for comparison to avoid type mismatch
  const userOrgId = req.user.organizationId ? req.user.organizationId.toString() : null;
  if (userOrgId !== orgId.toString()) {
    return sendError(res, 'You do not have access to this organization', 403, 'Forbidden');
  }

  // User belongs to the organization, proceed
  next();
}

/**
 * Middleware to filter resources by the user's organization
 * This automatically adds the organization filter to the request
 */
export function filterByOrganization(req: any, res: Response, next: NextFunction) {
  // If user is not logged in, proceed without filtering (public access)
  if (!req.isAuthenticated() || !req.user) {
    return next();
  }

  // System admins can see all resources by default
  if (req.user.isAdmin) {
    // If a specific organization filter is requested, honor it
    const requestedOrgId = req.query.organizationId;
    if (requestedOrgId) {
      req.organizationFilter = parseInt(requestedOrgId.toString(), 10);
    }
    return next();
  }

  // Regular users can only see resources from their organization
  if (req.user.organizationId) {
    req.organizationFilter = req.user.organizationId;
  }

  next();
}

/**
 * Middleware to check if a league belongs to the user's organization
 */
export async function hasAccessToLeague(req: any, leagueId: number): Promise<boolean> {
  if (!req.isAuthenticated() || !req.user) {
    return false;
  }

  // System admins can access all leagues
  if (req.user.isAdmin) {
    return true;
  }

  // Get the league
  const league = await storage.getLeague(leagueId);
  if (!league) {
    return false;
  }

  // Check if the league belongs to the user's organization
  // Convert both to strings for comparison to avoid type mismatch
  const leagueOrgId = league.organizationId ? league.organizationId.toString() : null;
  const userOrgId = req.user.organizationId ? req.user.organizationId.toString() : null;
  return leagueOrgId === userOrgId;
}

/**
 * Extract organization ID from request
 * This utility function gets the organization ID from the request
 * accounting for user permissions and query parameters
 */
export function getOrganizationFilter(req: any): number | null {
  // If not authenticated, no organization filter
  if (!req.isAuthenticated() || !req.user) {
    return null;
  }

  // If system admin and no specific organization requested, return null (all orgs)
  if (req.user.isAdmin && !req.query.organizationId) {
    return null;
  }

  // If system admin and specific organization requested, use that
  if (req.user.isAdmin && req.query.organizationId) {
    const orgId = parseInt(req.query.organizationId.toString(), 10);
    return isNaN(orgId) ? null : orgId;
  }

  // For regular users, use their organization ID
  return req.user.organizationId || null;
}