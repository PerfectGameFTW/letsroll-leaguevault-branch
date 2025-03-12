// Test script for organization functionality
// @ts-check
import fetch from 'node-fetch';
import { promisify } from 'util';
import { writeFile, readFile } from 'fs';
import { execSync } from 'child_process';

const writeFileAsync = promisify(writeFile);
const readFileAsync = promisify(readFile);

const BASE_URL = 'http://localhost:5001';

// Helper to capture cookies
let cookieJar = {};
let authToken = null;

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
      console.log('Received cookies:', cookies);
      // Save cookies for future requests
      cookieJar = cookies;
    }
    
    const data = await response.json();
    console.log('Login response:', data);
    
    if (response.ok) {
      return { success: true, userId: data.data?.id, user: data.data };
    } else {
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
    
    const data = await response.json();
    console.log('Register response:', data);
    
    if (response.ok) {
      return true;
    } else {
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
    
    const data = await response.json();
    console.log('Get organizations response:', data);
    
    if (response.ok) {
      return data.data;
    } else {
      throw new Error(`Failed to get organizations: ${data.error?.message || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('Get organizations error:', error);
    throw error;
  }
}

async function createOrganization(name, slug, adminEmail, adminPassword, adminName, token) {
  try {
    const response = await fetch(`${BASE_URL}/api/organizations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` })
      },
      body: JSON.stringify({
        name,
        slug,
        adminData: {
          email: adminEmail,
          password: adminPassword,
          name: adminName
        }
      }),
      credentials: 'include'
    });
    
    const data = await response.json();
    console.log('Create organization response:', data);
    
    if (response.ok) {
      return data.data;
    } else {
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
    authToken = await login(adminEmail, adminPassword);
    console.log('Login successful, token:', authToken);
    
    // Step 3: Get all organizations
    console.log('Step 3: Getting all organizations...');
    try {
      const organizations = await getOrganizations(authToken);
      console.log(`Found ${organizations.length} organizations`);
    } catch (error) {
      console.log('Failed to get organizations (might need admin permissions)');
    }
    
    // Step 4: Create a new organization with admin
    console.log('Step 4: Creating a new organization...');
    try {
      const newOrg = await createOrganization(
        'Test Organization',
        'test-org',
        'org-admin@example.com',
        'password123',
        'Organization Admin',
        authToken
      );
      console.log('Organization created successfully:', newOrg);
    } catch (error) {
      console.log('Failed to create organization (might need admin permissions)');
    }
    
    // Step 5: Get all organizations again to verify the new one
    console.log('Step 5: Getting all organizations again...');
    try {
      const organizations = await getOrganizations(authToken);
      console.log(`Found ${organizations.length} organizations`);
    } catch (error) {
      console.log('Failed to get organizations');
    }
    
    console.log('Tests completed!');
  } catch (error) {
    console.error('Test suite error:', error);
  }
}

runTests();