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
    
    const userId = adminRegisterResult.success ? adminRegisterResult.data.id : null;
    if (!userId) {
      console.error('Could not determine user ID');
      return;
    }
    
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
    
    // Now log in as the admin user
    console.log('\n3. Logging in as system admin...');
    const adminLogin = await login(adminData.email, adminData.password);
    
    if (!adminLogin.success) {
      console.error('Failed to login as system admin:', adminLogin.error);
      return;
    }
    
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
    } else {
      console.log('User registration successful');
    }
    
    // 3. Get the user ID (either from registration or login)
    const newUserId = registerResult.success ? registerResult.data.id : await getUserId(newUserData.email, adminLogin.cookies);
    
    if (!newUserId) {
      console.error('Could not determine user ID');
      return;
    }
    
    console.log(`User ID: ${newUserId}`);
    
    // 4. Add the user to Organization B as an admin
    console.log('\n3. Adding user to Organization B as an admin...');
    const organizationId = 2; // Organization B ID
    
    const addResult = await addUserToOrganization(newUserId, organizationId, true, adminLogin.cookies);
    
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
  const response = await fetch(`${BASE_URL}/api/admin/users`, {
    headers: {
      'Cookie': cookies,
    },
  });

  const data = await response.json();
  
  if (!response.ok || !data.success) {
    console.error('Failed to get users list');
    return null;
  }
  
  const user = data.data.find(u => u.email === email);
  return user ? user.id : null;
}

// Run the setup
createOrganizationAdmin();