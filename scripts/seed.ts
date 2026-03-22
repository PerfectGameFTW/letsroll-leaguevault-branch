#!/usr/bin/env tsx
const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { message: string; code?: string };
}

async function post<T = unknown>(
  path: string,
  body: unknown,
  cookies?: string,
): Promise<{ ok: boolean; data: ApiResponse<T>; cookies: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookies) headers['Cookie'] = cookies;

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const setCookie = res.headers.getSetCookie?.() ?? [];
  const newCookies = setCookie.map(c => c.split(';')[0]).join('; ');

  return {
    ok: res.ok,
    data: (await res.json()) as ApiResponse<T>,
    cookies: newCookies || cookies || '',
  };
}

async function get<T = unknown>(
  path: string,
  cookies?: string,
): Promise<{ ok: boolean; data: ApiResponse<T> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookies) headers['Cookie'] = cookies;

  const res = await fetch(`${BASE_URL}${path}`, { headers });
  return { ok: res.ok, data: (await res.json()) as ApiResponse<T> };
}

async function createFirstAdmin() {
  console.log('--- Creating first admin user ---');
  const result = await post('/api/setup/create-first-admin', {
    email: 'admin@example.com',
    password: 'fJ8#kL2@pQ5$rT9&',
    name: 'System Admin',
    phone: '555-123-4567',
  });

  if (result.ok && result.data.success) {
    console.log('First admin created:', (result.data.data as { email: string }).email);
  } else {
    console.log('Could not create first admin:', result.data.error?.message ?? 'unknown error');
  }
}

async function setupOrgAdmin() {
  console.log('\n--- Setting up organization admin ---');

  const loginResult = await post<{ id: number; email: string }>('/api/auth/login', {
    email: 'admin@example.com',
    password: 'fJ8#kL2@pQ5$rT9&',
  });

  if (!loginResult.ok || !loginResult.data.success) {
    console.error('Cannot log in as system admin:', loginResult.data.error?.message);
    return;
  }

  const adminCookies = loginResult.cookies;
  console.log('Logged in as system admin');

  const newUser = {
    email: 'testadmin2@example.com',
    password: 'vT9!mR2$qF8*dG3&zK7#',
    name: 'Test Admin B',
  };

  const regResult = await post('/api/auth/register', newUser);
  let userId: number | null = null;

  if (regResult.ok && regResult.data.success) {
    userId = (regResult.data.data as { id: number }).id;
    console.log('Registered new user, id:', userId);
  } else {
    console.log('Registration failed (user may already exist), attempting login...');
    const userLogin = await post<{ id: number }>('/api/auth/login', {
      email: newUser.email,
      password: newUser.password,
    });
    if (userLogin.ok && userLogin.data.success) {
      userId = userLogin.data.data!.id;
    }
  }

  if (!userId) {
    console.error('Could not determine user id');
    return;
  }

  const csrfResult = await get<{ csrfToken: string }>('/api/csrf-token', adminCookies);
  const csrfToken = csrfResult.data.data?.csrfToken ?? '';

  const addRes = await fetch(`${BASE_URL}/api/org-admin/users/${userId}/add`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: adminCookies,
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify({ organizationId: 2, isOrganizationAdmin: true }),
  });

  const addData: ApiResponse = await addRes.json();
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

  const loginResult = await post<{ id: number; email: string }>('/api/auth/login', {
    email: 'admin@example.com',
    password: 'fJ8#kL2@pQ5$rT9&',
  });

  if (!loginResult.ok || !loginResult.data.success) {
    console.error('Cannot log in as admin. Falling back to API endpoint without auth.');
  }

  const cookies = loginResult.cookies;
  const csrfResult = await get<{ csrfToken: string }>('/api/csrf-token', cookies);
  const csrfToken = csrfResult.data.data?.csrfToken ?? '';

  const res = await fetch(`${BASE_URL}/api/system-admin/create/${userId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookies ? { Cookie: cookies } : {}),
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
    },
  });

  const data: ApiResponse = await res.json();
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
