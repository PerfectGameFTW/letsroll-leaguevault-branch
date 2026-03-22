import { Request, Response, NextFunction } from "express";
import { sendError } from "../utils/api.js";

/**
 * Middleware that rejects unauthenticated requests at the router level.
 * Apply to any router whose endpoints all require authentication.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
    sendError(res, "Authentication required", 401, "AUTH_REQUIRED");
    return;
  }
  next();
}

/**
 * Middleware that requires org_admin or system_admin role.
 */
export function requireOrgAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
    sendError(res, "Authentication required", 401, "AUTH_REQUIRED");
    return;
  }
  const { role } = req.user;
  if (role !== "org_admin" && role !== "system_admin") {
    sendError(res, "Insufficient permissions", 403, "FORBIDDEN");
    return;
  }
  next();
}

/**
 * Middleware that requires system_admin role.
 */
export function requireSystemAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
    sendError(res, "Authentication required", 401, "AUTH_REQUIRED");
    return;
  }
  if (req.user.role !== "system_admin") {
    sendError(res, "Insufficient permissions", 403, "FORBIDDEN");
    return;
  }
  next();
}
