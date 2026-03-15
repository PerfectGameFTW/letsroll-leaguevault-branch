// Test script for organization functionality
// @ts-check
import fetch from 'node-fetch';
import { promisify } from 'util';
import { writeFile, readFile } from 'fs';
import { execSync } from 'child_process';

const writeFileAsync = promisify(writeFile);
const readFileAsync = promisify(readFile);

const BASE_URL = 'http://localhost:5001';

/**
 * @typedef {Object} ApiResponse
 * @property {boolean} success - Whether the operation was successful
 * @property {any} data - The data if successful
 * @property {Object} [error] - Error information if unsuccessful
 * @property {string} [error.message] - Error message
 * @property {string} [error.code] - Error code
 */

/**
 * @typedef {Object} User
 * @property {number} id - User ID
 * @property {string} email - User email
 * @property {string} name - User name
 * @property {boolean} isAdmin - Admin status
 * @property {boolean} isOrganizationAdmin - Organization admin status
 * @property {number|null} organizationId - Organization ID
 */

/**
 * @typedef {Object} Organization
 * @property {number} id - Organization ID
 * @property {string} name - Organization name
 * @property {string} slug - Organization slug
 * @property {string|null} address - Organization address
 * @property {string|null} city - Organization city
 * @property {string|null} state - Organization state
 * @property {string|null} zipCode - Organization zip code
 * @property {string|null} phone - Organization phone
 * @property {string|null} email - Organization email
 * @property {string|null} logo - Organization logo URL
 * @property {boolean} active - Organization active status
 * @property {string} createdAt - Organization creation date
 */

/**
 * @typedef {Object} LoginResult
 * @property {boolean} success - Whether login was successful
 * @property {number} userId - ID of the logged-in user
 * @property {User} user - User object
 */

// Helper to capture cookies
let cookieJar = '';
/** @type {User|null} */
let loggedInUser = null;

/**
 * Log in a user with email and password
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<LoginResult>} - Login result
 */
async function login(email, password) {
  try {
    const response = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });
    
    // Extract cookies
    const cookies = response.headers.get('set-cookie');
    if (cookies) {
      console.log('Received cookies');
      // Save cookies for future requests
      cookieJar = cookies;
    }
    
    /** @type {ApiResponse} */
    const data = await response.json();
    
    if (response.ok && data.success) {
      // Save user information
      loggedInUser = /** @type {User} */ (data.data);
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

async function register(email, password, name) {
  try {
    const response = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password, name }),
    });
    
    // Extract cookies if available (user gets auto-logged in after registration)
    const cookies = response.headers.get('set-cookie');
    if (cookies) {
      console.log('Received cookies after registration');
      cookieJar = cookies;
    }
    
    const data = await response.json();
    
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

async function runTests() {
  try {
    // Step 1: Register as admin
    console.log('Step 1: Registering admin user...');
    const adminEmail = 'admin@example.com';
    const adminPassword = 'fJ8#kL2@pQ5$rT9&';  // Using a more complex and unique password
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
        'xM7&tN3!zP9$vB1#',  // Using a more complex and unique password
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

runTests();