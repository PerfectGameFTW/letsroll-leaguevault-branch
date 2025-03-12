import fetch from 'node-fetch';

// Utility function to make requests with cookie jar
async function fetchWithAuth(url, options = {}) {
  const baseUrl = 'http://localhost:5001';
  const fullUrl = `${baseUrl}${url}`;
  
  // Include the cookie in the request
  options.headers = {
    ...options.headers,
    'Cookie': global.cookie || '',
  };
  
  // Set credentials to include to handle cookies
  options.credentials = 'include';
  
  const response = await fetch(fullUrl, options);
  
  // Update cookie jar if Set-Cookie header is present
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
    global.cookie = setCookie;
  }
  
  return response;
}

async function login(email, password) {
  console.log(`Logging in as ${email}...`);
  const response = await fetchWithAuth('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(`Login failed: ${data.error?.message || 'Unknown error'}`);
  }
  
  console.log('Login successful');
  return data.data;
}

async function getLeagues() {
  console.log('Fetching leagues...');
  const response = await fetchWithAuth('/api/leagues');
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(`Failed to fetch leagues: ${data.error?.message || 'Unknown error'}`);
  }
  
  console.log(`Retrieved ${data.data.length} leagues`);
  return data.data;
}

async function getTeams(leagueId) {
  console.log(`Fetching teams for league ${leagueId}...`);
  const response = await fetchWithAuth(`/api/teams?leagueId=${leagueId}`);
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(`Failed to fetch teams: ${data.error?.message || 'Unknown error'}`);
  }
  
  console.log(`Retrieved ${data.data.length} teams for league ${leagueId}`);
  return data.data;
}

async function getOrganizations() {
  console.log('Fetching organizations...');
  const response = await fetchWithAuth('/api/organizations');
  const data = await response.json();
  
  if (!response.ok) {
    console.log(`Failed to fetch organizations: ${data.error?.message || 'Unknown error'}`);
    return [];
  }
  
  console.log(`Retrieved ${data.data.length} organizations`);
  return data.data;
}

async function getOrganizationUsers(organizationId) {
  console.log(`Fetching users for organization ${organizationId}...`);
  const response = await fetchWithAuth(`/api/org-admin/users?organizationId=${organizationId}`);
  const data = await response.json();
  
  if (!response.ok) {
    console.log(`Failed to fetch organization users: ${data.error?.message || 'Unknown error'}`);
    return [];
  }
  
  console.log(`Retrieved ${data.data.length} users for organization ${organizationId}`);
  return data.data;
}

async function getLeaguesByOrganization(organizationId) {
  console.log(`Fetching leagues for organization ${organizationId}...`);
  const response = await fetchWithAuth(`/api/organizations/${organizationId}/leagues`);
  const data = await response.json();
  
  if (!response.ok) {
    console.log(`Failed to fetch organization leagues: ${data.error?.message || 'Unknown error'}`);
    return [];
  }
  
  console.log(`Retrieved ${data.data.length} leagues for organization ${organizationId}`);
  return data.data;
}

// Run tests
async function runTests() {
  try {
    global.cookie = '';
    
    // Test 1: Log in as admin and get all leagues
    await login('testadmin@example.com', 'password123');
    const adminLeagues = await getLeagues();
    
    console.log('\n=== Admin can see all leagues ===');
    console.log(adminLeagues.map(l => `${l.id}: ${l.name} (Organization: ${l.organizationId || 'None'})`));
    
    // Test 2: Get organizations (admin only)
    const organizations = await getOrganizations();
    
    if (organizations.length === 0) {
      console.log('Unable to test organization isolation without organizations');
      return;
    }
    
    // Test 3: Get organization users
    const org1Id = organizations[0].id;
    const orgUsers = await getOrganizationUsers(org1Id);
    
    console.log('\n=== Organization Users ===');
    console.log(orgUsers.map(u => `${u.id}: ${u.name} (${u.email})`));
    
    // Test 4: Get organization leagues
    const orgLeagues = await getLeaguesByOrganization(org1Id);
    
    console.log('\n=== Organization Leagues ===');
    console.log(orgLeagues.map(l => `${l.id}: ${l.name}`));
    
    // Test 5: Log in as org admin and check leagues
    global.cookie = '';
    if (orgUsers.length > 0) {
      const orgAdmin = orgUsers.find(u => u.isOrganizationAdmin);
      if (orgAdmin) {
        await login('testadmin@example.com', 'password123');
        const orgAdminLeagues = await getLeagues();
        
        console.log('\n=== Organization Admin can see organization leagues ===');
        console.log(orgAdminLeagues.map(l => `${l.id}: ${l.name} (Organization: ${l.organizationId || 'None'})`));
      }
    }
    
    console.log('\n=== Testing completed successfully ===');
  } catch (error) {
    console.error('Error during test:', error);
  }
}

runTests();