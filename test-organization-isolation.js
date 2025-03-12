// Script to test organization isolation in the bowling league management app
import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:5001';

async function fetchWithAuth(url, options = {}) {
  if (!options.headers) {
    options.headers = {};
  }
  
  if (options.cookies) {
    options.headers.Cookie = options.cookies;
    delete options.cookies;
  }

  options.headers['Content-Type'] = 'application/json';
  
  return fetch(url, options);
}

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

async function getLeagues(cookies) {
  const response = await fetchWithAuth(`${BASE_URL}/api/leagues`, {
    cookies,
  });

  const data = await response.json();
  return {
    success: response.ok,
    data: data.data,
    error: data.error,
  };
}

async function getTeams(leagueId, cookies) {
  const response = await fetchWithAuth(`${BASE_URL}/api/teams?leagueId=${leagueId}`, {
    cookies,
  });

  const data = await response.json();
  return {
    success: response.ok,
    data: data.data,
    error: data.error,
  };
}

async function getOrganizations(cookies) {
  const response = await fetchWithAuth(`${BASE_URL}/api/organizations`, {
    cookies,
  });

  const data = await response.json();
  return {
    success: response.ok,
    data: data.data,
    error: data.error,
  };
}

async function getOrganizationUsers(organizationId, cookies) {
  const response = await fetchWithAuth(`${BASE_URL}/api/org-admin/users?organizationId=${organizationId}`, {
    cookies,
  });

  const data = await response.json();
  return {
    success: response.ok,
    data: data.data,
    error: data.error,
  };
}

async function getLeaguesByOrganization(organizationId, cookies) {
  const response = await fetchWithAuth(`${BASE_URL}/api/organizations/${organizationId}/leagues`, {
    cookies,
  });

  const data = await response.json();
  return {
    success: response.ok,
    data: data.data,
    error: data.error,
  };
}

async function runTests() {
  console.log('-'.repeat(80));
  console.log('ORGANIZATION ISOLATION TEST');
  console.log('-'.repeat(80));
  
  try {
    // Test setup - create two test users from different organizations
    console.log('\n1. Logging in as organization A admin...');
    const orgAAdminLogin = await login('testadmin@example.com', 'TestPassword123!');
    
    if (!orgAAdminLogin.success) {
      console.error('Failed to login as organization A admin:', orgAAdminLogin.error);
      return;
    }
    
    console.log('Login successful for organization A admin');
    console.log('User:', orgAAdminLogin.data.email, 'Organization ID:', orgAAdminLogin.data.organizationId);
    
    console.log('\n2. Logging in as organization B admin...');
    const orgBAdminLogin = await login('testadmin2@example.com', 'TestPassword123!');
    
    if (!orgBAdminLogin.success) {
      console.error('Failed to login as organization B admin:', orgBAdminLogin.error);
      
      // If the second admin doesn't exist yet, you might need to create it first
      console.log('Note: You may need to create the Organization B admin first');
      return;
    }
    
    console.log('Login successful for organization B admin');
    console.log('User:', orgBAdminLogin.data.email, 'Organization ID:', orgBAdminLogin.data.organizationId);
    
    // Test 1: Organization visibility
    console.log('\n3. Testing organization visibility...');
    
    console.log('\n3.1 Organization list for Org A admin:');
    const orgListA = await getOrganizations(orgAAdminLogin.cookies);
    console.log('Organizations visible to Org A admin:', orgListA.data.length);
    orgListA.data.forEach(org => {
      console.log(`  - ${org.name} (ID: ${org.id})`);
    });
    
    console.log('\n3.2 Organization list for Org B admin:');
    const orgListB = await getOrganizations(orgBAdminLogin.cookies);
    console.log('Organizations visible to Org B admin:', orgListB.data.length);
    orgListB.data.forEach(org => {
      console.log(`  - ${org.name} (ID: ${org.id})`);
    });
    
    // Test 2: Organization users visibility
    console.log('\n4. Testing organization users visibility...');
    
    if (orgAAdminLogin.data.organizationId) {
      console.log('\n4.1 Organization A users:');
      const orgAUsers = await getOrganizationUsers(orgAAdminLogin.data.organizationId, orgAAdminLogin.cookies);
      
      if (orgAUsers.success) {
        console.log('Users in organization A:', orgAUsers.data.length);
        orgAUsers.data.forEach(user => {
          console.log(`  - ${user.email} (ID: ${user.id})`);
        });
      } else {
        console.error('Failed to get Organization A users:', orgAUsers.error);
      }
    }
    
    if (orgBAdminLogin.data.organizationId) {
      console.log('\n4.2 Organization B users:');
      const orgBUsers = await getOrganizationUsers(orgBAdminLogin.data.organizationId, orgBAdminLogin.cookies);
      
      if (orgBUsers.success) {
        console.log('Users in organization B:', orgBUsers.data.length);
        orgBUsers.data.forEach(user => {
          console.log(`  - ${user.email} (ID: ${user.id})`);
        });
      } else {
        console.error('Failed to get Organization B users:', orgBUsers.error);
      }
    }
    
    // Test 3: Cross-organization access (should fail)
    console.log('\n5. Testing cross-organization access (should fail)...');
    
    if (orgBAdminLogin.data.organizationId) {
      console.log('\n5.1 Org A admin accessing Org B users:');
      const crossOrgUsers = await getOrganizationUsers(orgBAdminLogin.data.organizationId, orgAAdminLogin.cookies);
      console.log('Access allowed?', crossOrgUsers.success);
      if (!crossOrgUsers.success) {
        console.log('  Error (expected):', crossOrgUsers.error?.message);
      } else {
        console.warn('  WARNING: Cross-organization access was allowed!');
      }
    }
    
    // Test 4: League isolation
    console.log('\n6. Testing league isolation...');
    
    console.log('\n6.1 Leagues visible to Org A admin:');
    const leaguesA = await getLeagues(orgAAdminLogin.cookies);
    
    if (leaguesA.success) {
      console.log('Total leagues visible:', leaguesA.data.length);
      leaguesA.data.forEach(league => {
        console.log(`  - ${league.name} (Organization ID: ${league.organizationId || 'None'})`);
      });
    } else {
      console.error('Failed to get leagues for Org A admin:', leaguesA.error);
    }
    
    console.log('\n6.2 Leagues visible to Org B admin:');
    const leaguesB = await getLeagues(orgBAdminLogin.cookies);
    
    if (leaguesB.success) {
      console.log('Total leagues visible:', leaguesB.data.length);
      leaguesB.data.forEach(league => {
        console.log(`  - ${league.name} (Organization ID: ${league.organizationId || 'None'})`);
      });
    } else {
      console.error('Failed to get leagues for Org B admin:', leaguesB.error);
    }
    
    // Test 5: Organization-specific leagues
    console.log('\n7. Testing organization-specific leagues...');
    
    if (orgAAdminLogin.data.organizationId) {
      console.log('\n7.1 Organization A leagues:');
      const orgALeagues = await getLeaguesByOrganization(orgAAdminLogin.data.organizationId, orgAAdminLogin.cookies);
      
      if (orgALeagues.success) {
        console.log('Leagues in organization A:', orgALeagues.data.length);
        orgALeagues.data.forEach(league => {
          console.log(`  - ${league.name} (ID: ${league.id})`);
        });
      } else {
        console.error('Failed to get Organization A leagues:', orgALeagues.error);
      }
    }
    
    if (orgBAdminLogin.data.organizationId) {
      console.log('\n7.2 Organization B leagues:');
      const orgBLeagues = await getLeaguesByOrganization(orgBAdminLogin.data.organizationId, orgBAdminLogin.cookies);
      
      if (orgBLeagues.success) {
        console.log('Leagues in organization B:', orgBLeagues.data.length);
        orgBLeagues.data.forEach(league => {
          console.log(`  - ${league.name} (ID: ${league.id})`);
        });
      } else {
        console.error('Failed to get Organization B leagues:', orgBLeagues.error);
      }
    }
    
    console.log('\n8. Testing cross-organization league access...');
    
    if (orgAAdminLogin.data.organizationId && orgBAdminLogin.data.organizationId) {
      console.log('\n8.1 Org B admin accessing Org A leagues:');
      const crossOrgLeagues = await getLeaguesByOrganization(orgAAdminLogin.data.organizationId, orgBAdminLogin.cookies);
      console.log('Access allowed?', crossOrgLeagues.success);
      if (!crossOrgLeagues.success) {
        console.log('  Error (expected):', crossOrgLeagues.error?.message);
      } else {
        console.warn('  WARNING: Cross-organization access was allowed!');
      }
    }
    
    console.log('-'.repeat(80));
    console.log('ORGANIZATION ISOLATION TEST COMPLETED');
    console.log('-'.repeat(80));
    
  } catch (error) {
    console.error('Error running tests:', error);
  }
}

// Run the tests
runTests();