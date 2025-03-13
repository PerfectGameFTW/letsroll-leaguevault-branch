# System Administrator Guide

This guide provides instructions for managing System Administrators in the Bowling League Management System.

## What is a System Administrator?

A System Administrator is a user with both `is_admin` and `is_organization_admin` flags set to `true`. This combination provides:

- Access to all administrative features
- Access across all organizations
- Ability to create and manage other system admins
- Access to sensitive system functions

## Creating a System Administrator

There are two ways to create a System Administrator: via SQL or via the API.

### Method 1: Via SQL (For database administrators)

You can create a system admin by running the following SQL command directly on the database:

```sql
UPDATE users 
SET is_admin = true, is_organization_admin = true 
WHERE id = [USER_ID];
```

Replace `[USER_ID]` with the ID of the user you want to promote to system admin.

Example:
```sql
UPDATE users 
SET is_admin = true, is_organization_admin = true 
WHERE id = 33;
```

### Method 2: Via API (For authenticated admin users)

The system provides API endpoints to manage system administrators:

1. **Create a System Administrator**:
   ```
   POST /api/system-admin/create/:id
   ```
   This endpoint requires admin authentication and will make a user with ID `:id` a system admin.

2. **Get All System Administrators**:
   ```
   GET /api/system-admin
   ```
   This endpoint requires admin authentication and returns a list of all system admins.

3. **Revoke System Administrator Privileges**:
   ```
   POST /api/system-admin/revoke/:id
   ```
   This endpoint requires admin authentication and will revoke system admin privileges from the user with ID `:id`.

## Important Notes

- You cannot revoke your own system admin privileges through the API.
- The system prevents revoking the last system admin to ensure there's always at least one.
- Users without organization affiliation can still be system admins (special handling is in place).
- Creating a system admin has significant security implications - use with caution.

## Verifying System Admin Status

To check if a user is a system admin, verify that both `isAdmin` and `isOrganizationAdmin` are set to `true` in the user object.

## System Admin Features

As a System Administrator, you have access to special features:

### Bowler Dashboard

The Bowler Dashboard is only accessible to System Administrators. This is protected by:

1. Route protection via the `SystemAdminRouteGuard` component
2. UI element hiding in the navigation menu
3. Server-side validation of requests

To access the Bowler Dashboard, navigate to `/bowler-dashboard` in the interface. The menu option will only be visible to system administrators.

When viewing the Bowler Dashboard as a System Administrator:
1. You'll see a "Back to Dashboard" link at the top of the page that returns you to the main dashboard.
2. A notice is displayed indicating that you're viewing the page as a System Administrator.
3. You will automatically see Dudo Kroppa's account information (user ID 31, linked to msjshearer@gmail.com).

### How Access Control Works

The application implements multiple layers of access control:

1. **Navigation Menu Control**:
   - The Bowler Dashboard link is only displayed in the menu if `isSystemAdmin = isAdmin && isOrganizationAdmin` is true.

2. **Route Guard**:
   - The `SystemAdminRouteGuard` component checks for system admin status (both flags must be true).
   - If a non-system admin tries to access the route directly, they are redirected to the home page.

3. **Server Verification**:
   - All API endpoints for system admin features verify server-side that the request is from a system admin.

## Recommended Security Practices

1. Limit the number of system administrators to those who absolutely need it.
2. Regularly audit the list of system administrators.
3. Always use strong passwords for system administrator accounts.
4. Consider implementing additional authentication methods for system admins.
5. Log and monitor system administrator actions.