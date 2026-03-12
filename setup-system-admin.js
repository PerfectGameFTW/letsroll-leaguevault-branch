/**
 * To create a system admin, run the following SQL command directly:
 * 
 * UPDATE users SET role = 'system_admin' WHERE id = [USER_ID];
 * 
 * Replace [USER_ID] with the ID of the user you want to promote to system admin.
 * 
 * Example: 
 * UPDATE users SET role = 'system_admin' WHERE id = 33;
 * 
 * This will make the user with ID 33 a system admin with access to all pages.
 * 
 * You can also use the following API endpoints:
 * - POST /api/system-admin/create/:id - Create a new system admin (requires admin auth)
 * - GET /api/system-admin - Get all system admins (requires admin auth)
 * - POST /api/system-admin/revoke/:id - Revoke system admin privileges (requires admin auth)
 */

console.log('System admin setup instructions:');
console.log('---------------------------------');
console.log('To create a system admin, use one of these methods:');
console.log('');
console.log('1. Direct SQL:');
console.log("   UPDATE users SET role = 'system_admin' WHERE id = [USER_ID];");
console.log('');
console.log('2. API endpoint (requires existing admin authentication):');
console.log('   POST /api/system-admin/create/:id');
console.log('');
console.log('System admins have access to all pages and administrative functions in the application.');
