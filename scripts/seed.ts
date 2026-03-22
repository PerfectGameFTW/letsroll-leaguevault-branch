#!/usr/bin/env tsx
import { login, apiPost, BASE_URL, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD, TEST_ORG_B_EMAIL, TEST_ORG_PASSWORD } from '../tests/helpers';

async function createFirstAdmin() {
  console.log('--- Creating first admin user ---');
  const { status, data } = await apiPost('/api/setup/create-first-admin', {
    email: TEST_ADMIN_EMAIL,
    password: TEST_ADMIN_PASSWORD,
    name: 'System Admin',
    phone: '555-123-4567',
  });

  if (status < 400 && data.success) {
    console.log('First admin created:', (data.data as { email: string }).email);
  } else {
    console.log('Could not create first admin:', data.error?.message ?? 'unknown error');
  }
}

async function setupOrgAdmin() {
  console.log('\n--- Setting up organization admin ---');

  const session = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
  console.log('Logged in as system admin');

  const newUser = {
    email: TEST_ORG_B_EMAIL,
    password: TEST_ORG_PASSWORD,
    name: 'Test Admin B',
  };

  const regResult = await apiPost('/api/auth/register', newUser);
  let userId: number | null = null;

  if (regResult.status < 400 && regResult.data.success) {
    userId = (regResult.data.data as { id: number }).id;
    console.log('Registered new user, id:', userId);
  } else {
    console.log('Registration failed (user may already exist), attempting login...');
    const userLogin = await apiPost<{ id: number }>('/api/auth/login', {
      email: newUser.email,
      password: newUser.password,
    });
    if (userLogin.status < 400 && userLogin.data.success) {
      userId = userLogin.data.data!.id;
    }
  }

  if (!userId) {
    console.error('Could not determine user id');
    return;
  }

  const addRes = await fetch(`${BASE_URL}/api/org-admin/users/${userId}/add`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: session.cookies,
      'x-csrf-token': session.csrfToken,
    },
    body: JSON.stringify({ organizationId: 2, isOrganizationAdmin: true }),
  });

  const addData = await addRes.json();
  if (addRes.ok && addData.success) {
    console.log(`User ${userId} added to organization 2 as admin`);
  } else {
    console.log('Failed to add user to organization:', addData.error?.message);
  }
}

async function promoteSystemAdmin() {
  console.log('\n--- Promoting user to system admin ---');

  const userId = process.argv[3];
  if (!userId) {
    console.error('Usage: tsx scripts/seed.ts system-admin <USER_ID>');
    console.log('Provide the numeric user ID to promote.');
    console.log('Alternative: run SQL directly:');
    console.log("  UPDATE users SET role = 'system_admin' WHERE id = <USER_ID>;");
    process.exit(1);
  }

  let session;
  try {
    session = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
  } catch {
    console.error('Cannot log in as admin. Falling back to API endpoint without auth.');
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session) {
    headers['Cookie'] = session.cookies;
    headers['x-csrf-token'] = session.csrfToken;
  }

  const res = await fetch(`${BASE_URL}/api/system-admin/create/${userId}`, {
    method: 'POST',
    headers,
  });

  const data = await res.json();
  if (res.ok && data.success) {
    console.log(`User ${userId} promoted to system admin`);
  } else {
    console.log('Failed to promote user:', data.error?.message ?? 'unknown error');
    console.log('You can also run SQL directly:');
    console.log(`  UPDATE users SET role = 'system_admin' WHERE id = ${userId};`);
  }
}

const command = process.argv[2];

switch (command) {
  case 'first-admin':
    createFirstAdmin();
    break;
  case 'org-admin':
    setupOrgAdmin();
    break;
  case 'system-admin':
    promoteSystemAdmin();
    break;
  case 'all':
    (async () => {
      await createFirstAdmin();
      await setupOrgAdmin();
    })();
    break;
  default:
    console.log('Usage: tsx scripts/seed.ts <command>');
    console.log('Commands:');
    console.log('  first-admin           Create the first admin user');
    console.log('  org-admin             Set up an organization admin (test user)');
    console.log('  system-admin <ID>     Promote user to system admin via API');
    console.log('  all                   Run first-admin + org-admin setup');
    break;
}
