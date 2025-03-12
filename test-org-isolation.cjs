// Test script for organization isolation using CommonJS
const { promisify } = require('util');
const { writeFile, readFile } = require('fs');

// Use Node.js built-in fetch API (available in newer Node.js versions)
// Use either dynamic import or the global fetch from Node 18+
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
 * Log in a user with email and password
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
      throw new Error(`Login failed: ${data.error?.message || 'Unknown error'}`);
    }
    
    console.log('Login successful');
    loggedInUser = data.data;
    return data.data;
  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
}

/**
 * Get all leagues
 */
async function getLeagues() {
  try {
    console.log('Fetching leagues...');
    const response = await fetchWithAuth('/api/leagues');
    const data = await response.json();
    
    if (!response.ok) {
      console.error('Failed to get leagues:', data.error);
      throw new Error(`Failed to get leagues: ${data.error?.message || 'Unknown error'}`);
    }
    
    console.log(`Retrieved ${data.data.length} leagues`);
    return data.data;
  } catch (error) {
    console.error('Get leagues error:', error);
    throw error;
  }
}

/**
 * Get teams for a league
 */
async function getTeams(leagueId) {
  try {
    console.log(`Fetching teams for league ${leagueId}...`);
    const response = await fetchWithAuth(`/api/teams?leagueId=${leagueId}`);
    const data = await response.json();
    
    if (!response.ok) {
      console.error('Failed to get teams:', data.error);
      throw new Error(`Failed to get teams: ${data.error?.message || 'Unknown error'}`);
    }
    
    console.log(`Retrieved ${data.data.length} teams for league ${leagueId}`);
    return data.data;
  } catch (error) {
    console.error('Get teams error:', error);
    throw error;
  }
}

/**
 * Get all organizations
 */
async function getOrganizations() {
  try {
    console.log('Fetching organizations...');
    const response = await fetchWithAuth('/api/organizations');
    const data = await response.json();
    
    if (!response.ok) {
      console.error('Failed to get organizations:', data.error);
      return [];
    }
    
    console.log(`Retrieved ${data.data.length} organizations`);
    return data.data;
  } catch (error) {
    console.error('Get organizations error:', error);
    return [];
  }
}

/**
 * Get users for an organization
 */
async function getOrganizationUsers(organizationId) {
  try {
    console.log(`Fetching users for organization ${organizationId}...`);
    const response = await fetchWithAuth(`/api/org-admin/users?organizationId=${organizationId}`);
    const data = await response.json();
    
    if (!response.ok) {
      console.error('Failed to get organization users:', data.error);
      return [];
    }
    
    console.log(`Retrieved ${data.data.length} users for organization ${organizationId}`);
    return data.data;
  } catch (error) {
    console.error('Get organization users error:', error);
    return [];
  }
}

/**
 * Get leagues for an organization
 */
async function getOrganizationLeagues(organizationId) {
  try {
    console.log(`Fetching leagues for organization ${organizationId}...`);
    const response = await fetchWithAuth(`/api/organizations/${organizationId}/leagues`);
    const data = await response.json();
    
    if (!response.ok) {
      console.error('Failed to get organization leagues:', data.error);
      return [];
    }
    
    console.log(`Retrieved ${data.data.length} leagues for organization ${organizationId}`);
    return data.data;
  } catch (error) {
    console.error('Get organization leagues error:', error);
    return [];
  }
}

/**
 * Run all tests
 */
async function runTests() {
  try {
    console.log('=== ORGANIZATION ISOLATION TESTS ===');
    
    // Test 1: Log in as admin and get all leagues
    console.log('\nTest 1: Admin access to all leagues');
    try {
      await login('sysadmin@example.com', 'Password123!');
      const adminLeagues = await getLeagues();
      
      console.log('Admin can see leagues:');
      adminLeagues.forEach(league => {
        console.log(`  - ${league.name} (Organization: ${league.organizationId || 'None'})`);
      });
    } catch (error) {
      console.log('Test 1 failed:', error.message);
    }
    
    // Test 2: Get organizations as admin
    console.log('\nTest 2: Admin access to organizations');
    let organizations = [];
    try {
      organizations = await getOrganizations();
      
      console.log('Admin can see organizations:');
      organizations.forEach(org => {
        console.log(`  - ${org.name} (ID: ${org.id})`);
      });
    } catch (error) {
      console.log('Test 2 failed:', error.message);
    }
    
    if (organizations.length === 0) {
      console.log('No organizations found, cannot continue isolation tests');
      return;
    }
    
    // Test 3: Get organization users
    console.log('\nTest 3: Organization user access');
    let org1Id = organizations[0].id;
    let orgUsers = [];
    try {
      orgUsers = await getOrganizationUsers(org1Id);
      
      console.log(`Users in organization ${organizations[0].name}:`);
      orgUsers.forEach(user => {
        console.log(`  - ${user.name || user.email} (${user.isOrganizationAdmin ? 'Organization Admin' : 'Regular User'})`);
      });
    } catch (error) {
      console.log('Test 3 failed:', error.message);
    }
    
    // Test 4: Get leagues for a specific organization
    console.log('\nTest 4: Organization-specific leagues');
    try {
      const orgLeagues = await getOrganizationLeagues(org1Id);
      
      console.log(`Leagues in organization ${organizations[0].name}:`);
      orgLeagues.forEach(league => {
        console.log(`  - ${league.name}`);
      });
    } catch (error) {
      console.log('Test 4 failed:', error.message);
    }
    
    // Test 5: Login as organization admin and check access
    if (orgUsers.length > 0) {
      const orgAdmin = orgUsers.find(user => user.isOrganizationAdmin);
      if (orgAdmin) {
        console.log('\nTest 5: Organization admin isolation');
        try {
          // Clear cookie jar
          cookieJar = '';
          
          await login(orgAdmin.email, 'Password123!'); // Using enhanced password
          const orgAdminLeagues = await getLeagues();
          
          console.log(`Organization admin ${orgAdmin.email} can see leagues:`);
          orgAdminLeagues.forEach(league => {
            console.log(`  - ${league.name} (Organization: ${league.organizationId})`);
          });
          
          // Verify that all leagues belong to the same organization
          const allBelongToSameOrg = orgAdminLeagues.every(league => league.organizationId === org1Id);
          console.log(`All leagues belong to the same organization: ${allBelongToSameOrg ? 'YES ✓' : 'NO ✗'}`);
          
        } catch (error) {
          console.log('Test 5 failed:', error.message);
        }
      } else {
        console.log('No organization admin found, skipping Test 5');
      }
    }
    
    console.log('\n=== ORGANIZATION ISOLATION TESTS COMPLETED ===');
  } catch (error) {
    console.error('Test suite error:', error);
  }
}

// Run the test suite
runTests();