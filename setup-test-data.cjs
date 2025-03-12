// Setup script to create test data for organization isolation
const { promisify } = require('util');
const { writeFile, readFile } = require('fs');

// Use Node.js built-in fetch API
const fetch = globalThis.fetch;

// Always use localhost since the Express server is running there directly
const BASE_URL = 'http://localhost:5001';

console.log(`Using server URL: ${BASE_URL}`);

// Helper to capture cookies
let cookieJar = '';
let loggedInUser = null;

/**
 * Fetch with Cookie authentication
 */
async function fetchWithAuth(url, options = {}) {
  const fullUrl = `${BASE_URL}${url}`;
  
  const headers = {
    ...options.headers || {},
  };
  
  // Add cookies if available
  if (cookieJar) {
    headers['Cookie'] = cookieJar;
  }
  
  const response = await fetch(fullUrl, {
    ...options,
    headers
  });
  
  // Update cookies if provided
  const cookies = response.headers.get('set-cookie');
  if (cookies) {
    cookieJar = cookies;
  }
  
  return response;
}

/**
 * Register a new user
 */
async function register(email, password, name) {
  try {
    console.log(`Registering user ${name} with email ${email}...`);
    const response = await fetchWithAuth('/api/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password, name }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('Registration failed:', data.error);
      return null;
    }
    
    console.log('Registration successful');
    if (data.data) {
      loggedInUser = data.data;
    }
    return data.data;
  } catch (error) {
    console.error('Registration error:', error);
    return null;
  }
}

/**
 * Create an organization
 */
async function createOrganization(name, slug, description = null) {
  try {
    console.log(`Creating organization ${name}...`);
    const response = await fetchWithAuth('/api/organizations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, slug, description }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('Organization creation failed:', data.error);
      return null;
    }
    
    console.log('Organization created successfully');
    return data.data;
  } catch (error) {
    console.error('Organization creation error:', error);
    return null;
  }
}

/**
 * Create a league
 */
async function createLeague(name, organizationId, description = null) {
  try {
    console.log(`Creating league ${name} for organization ${organizationId}...`);
    const response = await fetchWithAuth('/api/leagues', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        name, 
        organizationId, 
        description, 
        active: true, 
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days from now
        weekDay: 1, // Monday 
        startTime: '18:00',
        numberOfWeeks: 12,
        gamesPerSeries: 3
      }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('League creation failed:', data.error);
      return null;
    }
    
    console.log('League created successfully');
    return data.data;
  } catch (error) {
    console.error('League creation error:', error);
    return null;
  }
}

/**
 * Login function
 */
async function login(email, password) {
  try {
    console.log(`Logging in as ${email}...`);
    const response = await fetchWithAuth('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('Login failed:', data.error);
      return null;
    }
    
    console.log('Login successful');
    loggedInUser = data.data;
    return data.data;
  } catch (error) {
    console.error('Login error:', error);
    return null;
  }
}

/**
 * Make a user an admin
 */
async function makeUserAdmin(userId) {
  try {
    console.log(`Making user ${userId} an admin...`);
    const response = await fetchWithAuth(`/api/admin/users/${userId}/admin-status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ isAdmin: true }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('Failed to make user an admin:', data.error);
      return false;
    }
    
    console.log('User is now an admin');
    return true;
  } catch (error) {
    console.error('Make admin error:', error);
    return false;
  }
}

/**
 * Make a user an organization admin
 */
async function makeUserOrgAdmin(userId, isOrgAdmin = true) {
  try {
    console.log(`Making user ${userId} ${isOrgAdmin ? 'an' : 'not an'} organization admin...`);
    const response = await fetchWithAuth(`/api/org-admin/users/${userId}/admin-status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ isOrganizationAdmin: isOrgAdmin }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('Failed to update organization admin status:', data.error);
      return false;
    }
    
    console.log('User organization admin status updated');
    return true;
  } catch (error) {
    console.error('Update org admin status error:', error);
    return false;
  }
}

/**
 * Set a user's organization
 */
async function setUserOrganization(userId, organizationId) {
  try {
    console.log(`Setting user ${userId} to organization ${organizationId}...`);
    const response = await fetchWithAuth(`/api/org-admin/users/${userId}/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ organizationId }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('Failed to set user organization:', data.error);
      return false;
    }
    
    console.log('User organization set successfully');
    return true;
  } catch (error) {
    console.error('Set user organization error:', error);
    return false;
  }
}

/**
 * Setup test data
 */
async function setupTestData() {
  try {
    // 1. Register system admin
    const sysAdmin = await register('sysadmin@example.com', 'Xkd73!Pqr#2025', 'System Admin');
    if (!sysAdmin) {
      console.log('Trying to log in as existing system admin');
      await login('sysadmin@example.com', 'Xkd73!Pqr#2025');
    }
    
    // 2. Make the user a system admin
    await makeUserAdmin(loggedInUser.id);
    
    // 3. Create two organizations
    const org1 = await createOrganization('Bowling Organization A', 'org-a', 'First test organization');
    const org2 = await createOrganization('Bowling Organization B', 'org-b', 'Second test organization');
    
    if (!org1 || !org2) {
      console.error('Failed to create organizations, aborting setup');
      return;
    }
    
    // 4. Create two organization admins
    const orgAdmin1 = await register('orgadmin1@example.com', 'Jm8B@3Kl$2025a', 'Org A Admin');
    
    // Need to log back in as system admin
    await login('sysadmin@example.com', 'Xkd73!Pqr#2025');
    
    const orgAdmin2 = await register('orgadmin2@example.com', 'Gh5T$7Zw!2025b', 'Org B Admin');
    
    // Log back in as system admin
    await login('sysadmin@example.com', 'Xkd73!Pqr#2025');
    
    // 5. Assign users to organizations and make them org admins
    if (orgAdmin1) {
      await setUserOrganization(orgAdmin1.id, org1.id);
      await makeUserOrgAdmin(orgAdmin1.id, true);
    }
    
    if (orgAdmin2) {
      await setUserOrganization(orgAdmin2.id, org2.id);
      await makeUserOrgAdmin(orgAdmin2.id, true);
    }
    
    // 6. Create regular users for each organization
    const regularUser1 = await register('user1@example.com', 'Rx9@F#7qM2025c', 'User Org A');
    
    // Log back in as system admin
    await login('sysadmin@example.com', 'Xkd73!Pqr#2025');
    
    const regularUser2 = await register('user2@example.com', 'Lp3$W#8vN2025d', 'User Org B');
    
    // Log back in as system admin
    await login('sysadmin@example.com', 'Xkd73!Pqr#2025');
    
    if (regularUser1) {
      await setUserOrganization(regularUser1.id, org1.id);
    }
    
    if (regularUser2) {
      await setUserOrganization(regularUser2.id, org2.id);
    }
    
    // 7. Create leagues for each organization
    
    // Login as Org A admin to create leagues for Org A
    await login('orgadmin1@example.com', 'Jm8B@3Kl$2025a');
    const league1a = await createLeague('League A1', org1.id, 'First league for Org A');
    const league1b = await createLeague('League A2', org1.id, 'Second league for Org A');
    
    // Login as Org B admin to create leagues for Org B
    await login('orgadmin2@example.com', 'Gh5T$7Zw!2025b');
    const league2a = await createLeague('League B1', org2.id, 'First league for Org B');
    const league2b = await createLeague('League B2', org2.id, 'Second league for Org B');
    
    console.log('\n=== TEST DATA SETUP COMPLETED SUCCESSFULLY ===');
    console.log('Created organizations:');
    console.log(`  - ${org1.name} (ID: ${org1.id})`);
    console.log(`  - ${org2.name} (ID: ${org2.id})`);
    
    console.log('\nCreated users:');
    console.log('  - System Admin: sysadmin@example.com');
    console.log('  - Org A Admin: orgadmin1@example.com');
    console.log('  - Org B Admin: orgadmin2@example.com');
    console.log('  - User Org A: user1@example.com');
    console.log('  - User Org B: user2@example.com');
    
    console.log('\nCreated leagues:');
    if (league1a) console.log(`  - ${league1a.name} (Organization: ${org1.name})`);
    if (league1b) console.log(`  - ${league1b.name} (Organization: ${org1.name})`);
    if (league2a) console.log(`  - ${league2a.name} (Organization: ${org2.name})`);
    if (league2b) console.log(`  - ${league2b.name} (Organization: ${org2.name})`);
    
  } catch (error) {
    console.error('Setup test data error:', error);
  }
}

// Run the setup
setupTestData();