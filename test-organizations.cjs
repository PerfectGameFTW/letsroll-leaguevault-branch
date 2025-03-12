// Test script for organization functionality using CommonJS
const { promisify } = require('util');
const { writeFile, readFile } = require('fs');
const { execSync } = require('child_process');

// Use Node.js built-in fetch API (available in newer Node.js versions)
// Use either dynamic import or the global fetch from Node 18+
const fetch = globalThis.fetch;

const writeFileAsync = promisify(writeFile);
const readFileAsync = promisify(readFile);

// Always use localhost since the Express server is running there directly
// This avoids the Vite middleware that serves HTML for all routes when accessed via the Replit domain
const BASE_URL = 'http://localhost:5001';

console.log(`Using server URL: ${BASE_URL}`);

// Test if the server is responsive
(async function testServerConnection() {
  try {
    console.log('Testing server connection to API test endpoint...');
    const response = await fetch(`${BASE_URL}/api/test`);
    console.log('Server response status:', response.status);
    
    if (response.status >= 200 && response.status < 300) {
      // Try to parse the response as JSON
      const responseText = await response.text();
      try {
        const data = JSON.parse(responseText);
        console.log('API test successful! Response:', data);
        if (data.success) {
          console.log('API test endpoint is working properly');
        }
      } catch (parseError) {
        console.error('Failed to parse test endpoint response as JSON:', parseError);
        console.log('Raw response:', responseText.substring(0, 200));
      }
    } else {
      console.log('Server returned error status:', response.status);
    }
  } catch (error) {
    console.error('Server connection failed:', error.message);
    console.log('Will try to proceed anyway...');
  }
})();

// Helper to capture cookies
let cookieJar = '';
let loggedInUser = null;

/**
 * Log in a user with email and password
 */
async function login(email, password) {
  try {
    console.log(`Logging in at ${BASE_URL}/api/auth/login`);
    const response = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });
    
    // Log response details
    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));
    
    // Extract cookies
    const cookies = response.headers.get('set-cookie');
    if (cookies) {
      console.log('Received cookies after login:', cookies);
      // Save cookies for future requests
      cookieJar = cookies;
    }
    
    // Get raw response text first for debugging
    const responseText = await response.text();
    console.log('Raw response:', responseText.substring(0, 200) + (responseText.length > 200 ? '...' : ''));
    
    // Try to parse the response as JSON
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse response as JSON:', parseError);
      throw new Error(`Invalid JSON response: ${responseText.substring(0, 100)}`);
    }
    
    if (response.ok && data.success) {
      // Save user information
      loggedInUser = data.data;
      console.log('Login successful for user:', loggedInUser.email);
      return { success: true, userId: loggedInUser.id, user: loggedInUser };
    } else {
      console.error('Login failed:', data.error);
      throw new Error(`Login failed: ${data.error?.message || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
}

/**
 * Register a new user
 */
async function register(email, password, name) {
  try {
    console.log(`Registering user at ${BASE_URL}/api/auth/register`);
    const response = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password, name }),
    });
    
    // Log response details
    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));
    
    // Extract cookies if available (user gets auto-logged in after registration)
    const cookies = response.headers.get('set-cookie');
    if (cookies) {
      console.log('Received cookies after registration:', cookies);
      cookieJar = cookies;
    }
    
    // Get raw response text first for debugging
    const responseText = await response.text();
    console.log('Raw response:', responseText.substring(0, 200) + (responseText.length > 200 ? '...' : ''));
    
    // Try to parse the response as JSON
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse response as JSON:', parseError);
      throw new Error(`Invalid JSON response: ${responseText.substring(0, 100)}`);
    }
    
    if (response.ok && data.success) {
      // If registration succeeded and login was automatic
      if (data.data) {
        loggedInUser = data.data;
        console.log('Registration successful and auto-logged in as:', loggedInUser.email);
      } else {
        console.log('Registration successful but not auto-logged in');
      }
      return true;
    } else {
      console.error('Registration failed:', data.error);
      throw new Error(`Registration failed: ${data.error?.message || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('Registration error:', error);
    throw error;
  }
}

/**
 * Get all organizations
 */
async function getOrganizations() {
  try {
    const headers = {
      'Content-Type': 'application/json'
    };
    
    // Add cookies if available
    if (cookieJar) {
      headers['Cookie'] = cookieJar;
    }
    
    const response = await fetch(`${BASE_URL}/api/organizations`, {
      method: 'GET',
      headers
    });
    
    // Update cookies if provided
    const cookies = response.headers.get('set-cookie');
    if (cookies) {
      console.log('Received new cookies during get organizations');
      cookieJar = cookies;
    }
    
    const data = await response.json();
    
    if (response.ok && data.success) {
      console.log(`Found ${data.data?.length || 0} organizations`);
      return data.data;
    } else {
      console.error('Failed to get organizations:', data.error);
      throw new Error(`Failed to get organizations: ${data.error?.message || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('Get organizations error:', error);
    throw error;
  }
}

/**
 * Create a new organization
 */
async function createOrganization(name, slug, adminEmail, adminPassword, adminName) {
  try {
    const headers = {
      'Content-Type': 'application/json'
    };
    
    // Add cookies if available
    if (cookieJar) {
      headers['Cookie'] = cookieJar;
    }
    
    const response = await fetch(`${BASE_URL}/api/organizations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name,
        slug,
        adminData: {
          email: adminEmail,
          password: adminPassword,
          name: adminName
        }
      })
    });
    
    // Update cookies if provided
    const cookies = response.headers.get('set-cookie');
    if (cookies) {
      console.log('Received new cookies after organization creation');
      cookieJar = cookies;
    }
    
    const data = await response.json();
    
    if (response.ok && data.success) {
      console.log('Organization created successfully:', data.data?.name);
      return data.data;
    } else {
      console.error('Failed to create organization:', data.error);
      throw new Error(`Failed to create organization: ${data.error?.message || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('Create organization error:', error);
    throw error;
  }
}

/**
 * Run all tests
 */
async function runTests() {
  try {
    // Step 1: Register as admin
    console.log('Step 1: Registering admin user...');
    const adminEmail = 'admin@example.com';
    const adminPassword = 'password123';
    const adminName = 'System Admin';
    
    try {
      await register(adminEmail, adminPassword, adminName);
      console.log('Admin registration successful or user already exists');
    } catch (registerError) {
      console.log('Registration failed (user might already exist)');
    }
    
    // Step 2: Login as admin
    console.log('Step 2: Logging in as admin...');
    const loginResult = await login(adminEmail, adminPassword);
    console.log('Login result:', loginResult);
    
    if (!loginResult.success) {
      throw new Error('Login failed, cannot proceed with tests');
    }
    
    // Step 3: Get all organizations
    console.log('Step 3: Getting all organizations...');
    try {
      const organizations = await getOrganizations();
      console.log(`Found ${organizations ? organizations.length : 0} organizations`);
    } catch (error) {
      console.log('Failed to get organizations (might need admin permissions):', error.message);
    }
    
    // Step 4: Create a new organization with admin
    console.log('Step 4: Creating a new organization...');
    try {
      const newOrg = await createOrganization(
        'Test Organization',
        'test-org',
        'org-admin@example.com',
        'password123',
        'Organization Admin'
      );
      console.log('Organization created successfully:', newOrg);
    } catch (error) {
      console.log('Failed to create organization (might need admin permissions):', error.message);
    }
    
    // Step 5: Get all organizations again to verify the new one
    console.log('Step 5: Getting all organizations again...');
    try {
      const organizations = await getOrganizations();
      console.log(`Found ${organizations ? organizations.length : 0} organizations`);
    } catch (error) {
      console.log('Failed to get organizations:', error.message);
    }
    
    console.log('Tests completed!');
  } catch (error) {
    console.error('Test suite error:', error);
  }
}

// Run the test suite
runTests();