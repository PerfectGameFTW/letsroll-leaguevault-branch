// Script to create an organization admin user for testing
import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:5001';

async function login(email, password) {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  const setCookieHeader = response.headers.get('set-cookie');
  const data = await response.json();
  
  return {
    success: response.ok,
    data: data.data,
    cookies: setCookieHeader,
    error: data.error,
  };
}

async function registerUser(userData) {
  const response = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(userData),
  });

  const data = await response.json();
  return {
    success: response.ok,
    data: data.data,
    error: data.error,
  };
}

async function addUserToOrganization(userId, organizationId, isAdmin, cookies) {
  const response = await fetch(`${BASE_URL}/api/org-admin/users/${userId}/add`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookies,
    },
    body: JSON.stringify({
      organizationId,
      isOrganizationAdmin: isAdmin,
    }),
  });

  const data = await response.json();
  return {
    success: response.ok,
    data: data.data,
    error: data.error,
  };
}

async function createOrganizationAdmin() {
  try {
    console.log('-'.repeat(80));
    console.log('ORGANIZATION ADMIN SETUP');
    console.log('-'.repeat(80));

    // 1. First, create an admin user
    console.log('\n1. Creating a new admin user...');
    const adminData = {
      email: 'newadmin@example.com',
      password: 'kJd$8#pL7@vB2!xZ9', // Using a more complex secure password
      name: 'New System Admin'
    };
    
    const adminRegisterResult = await registerUser(adminData);
    
    if (!adminRegisterResult.success) {
      console.error('Failed to register admin user:', adminRegisterResult.error);
      console.log('Attempting to log in with these credentials instead...');
      
      // Try to log in if the user already exists
      const adminLogin = await login(adminData.email, adminData.password);
      
      if (!adminLogin.success) {
        console.error('Failed to login with admin credentials:', adminLogin.error);
        return;
      }
      
      console.log('Login successful with existing admin user');
    } else {
      console.log('Admin user created successfully');
    }
    
    // Now make the user an admin using the first-system-admin endpoint
    // This will work if there are no existing admins
    console.log('\n2. Setting the user as system admin...');
    
    // Get user ID either from registration or login
    let userId = adminRegisterResult.success ? adminRegisterResult.data.id : null;
    if (!userId) {
      // If login was successful but we don't have user ID, get it from the user list
      const adminLoginResult = await login(adminData.email, adminData.password);
      userId = await getUserId(adminData.email, adminLoginResult.cookies);
      if (!userId) {
        console.error('Could not determine user ID');
        return;
      }
    }
    console.log('Got user ID:', userId);
    
    const makeAdminResponse = await fetch(`${BASE_URL}/api/admin-update/first-system-admin/${userId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    const makeAdminResult = await makeAdminResponse.json();
    
    if (!makeAdminResponse.ok || !makeAdminResult.success) {
      console.error('Failed to make user a system admin:', makeAdminResult.error);
      console.log('Continuing assuming the user already has admin privileges...');
    } else {
      console.log('User successfully set as system admin');
    }
    
    // Log in again as the admin user with updated permissions
    console.log('\n3. Logging in as system admin...');
    const adminLoginRefresh = await login(adminData.email, adminData.password);
    
    if (!adminLoginRefresh.success) {
      console.error('Failed to login as system admin:', adminLoginRefresh.error);
      return;
    }
    
    // Store the admin login cookies for later use
    const adminCookies = adminLoginRefresh.cookies;
    
    console.log('Login successful as system admin');
    
    // 2. Register a new user for Organization B
    console.log('\n2. Registering a new user for Organization B...');
    const newUserData = {
      email: 'testadmin2@example.com',
      password: 'vT9!mR2$qF8*dG3&zK7#', // Using a more complex secure password
      name: 'Test Admin B',
    };
    
    const registerResult = await registerUser(newUserData);
    
    if (!registerResult.success) {
      console.error('Failed to register new user:', registerResult.error);
      
      // Try logging in if the user might already exist
      console.log('Attempting to log in instead...');
      const loginResult = await login(newUserData.email, newUserData.password);
      
      if (!loginResult.success) {
        console.error('Could not register or login as the test user');
        return;
      }
      
      console.log('Login successful for existing user');
      
      // Store the login result in a variable accessible in the outer scope
      registerResult.loginResult = loginResult;
    } else {
      console.log('User registration successful');
    }
    
    // 3. Get the user ID (either from registration or login)
    let newUserId = registerResult.success ? registerResult.data.id : null;
    
    if (!newUserId) {
      // Try to get user ID with admin cookies
      newUserId = await getUserId(newUserData.email, adminCookies);
      
      if (!newUserId) {
        // If we still can't find the ID, try with the login result cookies
        if (registerResult.loginResult && registerResult.loginResult.success) {
          console.log('Attempting to get user ID from login cookies');
          // When a user logs in, they get a cookie that identifies them, so we can use that
          // to determine their own user ID
          const userResponse = await fetch(`${BASE_URL}/api/user`, {
            headers: {
              'Cookie': registerResult.loginResult.cookies,
            },
          });
          
          const userData = await userResponse.json();
          
          if (userResponse.ok && userData.success) {
            console.log('Found user ID from login session:', userData.data.id);
            newUserId = userData.data.id;
          }
        }
        
        if (!newUserId) {
          console.error('Could not determine user ID');
          return;
        }
      }
    }
    
    console.log(`User ID: ${newUserId}`);
    
    // 4. Add the user to Organization B as an admin
    console.log('\n3. Adding user to Organization B as an admin...');
    const organizationId = 2; // Organization B ID
    
    const addResult = await addUserToOrganization(newUserId, organizationId, true, adminCookies);
    
    if (!addResult.success) {
      console.error('Failed to add user to organization:', addResult.error);
      return;
    }
    
    console.log('Successfully added user to Organization B as an admin');
    console.log(`User ID: ${newUserId}`);
    console.log(`Organization ID: ${organizationId}`);
    console.log(`User Email: ${newUserData.email}`);
    
    console.log('-'.repeat(80));
    console.log('ORGANIZATION ADMIN SETUP COMPLETED');
    console.log('-'.repeat(80));
    
  } catch (error) {
    console.error('Error setting up organization admin:', error);
  }
}

// Helper function to get user ID from email
async function getUserId(email, cookies) {
  try {
    console.log(`Attempting to get user ID for email: ${email}`);

    // First try using the normal admin route
    console.log('Trying to access /api/admin/users');
    const adminResponse = await fetch(`${BASE_URL}/api/admin/users`, {
      headers: {
        'Cookie': cookies,
      },
    });

    const adminData = await adminResponse.json();
    console.log('Admin users response status:', adminResponse.status);
    
    if (adminResponse.ok && adminData.success) {
      console.log(`Found ${adminData.data.length} users from admin endpoint`);
      const user = adminData.data.find(u => u.email === email);
      if (user) {
        console.log(`Found user with ID ${user.id}`);
        return user.id;
      }
    } else {
      console.log('Admin users request failed, trying organization admin route');
    }
    
    // Try using the organization admin route as a fallback
    const orgResponse = await fetch(`${BASE_URL}/api/organization-admin/users`, {
      headers: {
        'Cookie': cookies,
      },
    });
    
    const orgData = await orgResponse.json();
    console.log('Organization admin users response status:', orgResponse.status);
    
    if (orgResponse.ok && orgData.success) {
      console.log(`Found ${orgData.data.length} users from organization admin endpoint`);
      const user = orgData.data.find(u => u.email === email);
      if (user) {
        console.log(`Found user with ID ${user.id}`);
        return user.id;
      }
    } else {
      console.log('Organization admin users request failed');
    }
    
    // If we still can't find the user, try to get current user info
    const userResponse = await fetch(`${BASE_URL}/api/user`, {
      headers: {
        'Cookie': cookies,
      },
    });
    
    const userData = await userResponse.json();
    
    if (userResponse.ok && userData.success && userData.data.email === email) {
      console.log(`Found own user with ID ${userData.data.id}`);
      return userData.data.id;
    }
    
    console.log('Failed to find user ID through all available methods');
    return null;
  } catch (error) {
    console.error('Error getting user ID:', error);
    return null;
  }
}

// Run the setup
createOrganizationAdmin();