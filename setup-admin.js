// Script to create the first admin user in the system
import fetch from 'node-fetch';

// Use the correct server URL - environment port instead of hardcoded port
const BASE_URL = 'http://localhost:5001';

async function createFirstAdmin() {
  try {
    // Admin user credentials
    const adminData = {
      email: 'admin@example.com',
      password: 'fJ8#kL2@pQ5$rT9&',  // Using a secure password
      name: 'System Admin',
      phone: '555-123-4567' // Optional
    };

    console.log('Attempting to create first admin user...');
    
    // Request to create the first admin
    const response = await fetch(`${BASE_URL}/api/setup/create-first-admin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(adminData)
    });

    const result = await response.json();
    
    if (response.ok && result.success) {
      console.log('Success! First admin user created.');
      console.log('Admin details:', {
        id: result.data.id,
        email: result.data.email,
        name: result.data.name,
        isAdmin: result.data.isAdmin
      });
    } else {
      console.error('Failed to create admin user:', result.error);
    }
  } catch (error) {
    console.error('Error executing request:', error);
  }
}

// Execute the function
createFirstAdmin();