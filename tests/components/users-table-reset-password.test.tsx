/**
 * Component test for the Admin Reset Password button (task #423).
 *
 * Pins the visibility rules — they have to mirror the backend
 * authorization in `server/routes/organization-admin.ts` so admins
 * never see a button that would 403:
 *
 *   - Visible for ordinary users in the same org.
 *   - Hidden when the row is the current admin (the endpoint refuses
 *     self-resets — change-password handles that flow).
 *   - Hidden when the row is a system_admin (system-admin password
 *     rotation goes through dedicated tooling).
 *
 * Cross-org filtering is enforced by the parent page's query (it
 * only fetches users in the caller's own organization), so the
 * table itself doesn't need to re-check it; that's pinned in the
 * org-admin route tests, not here.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  UsersTable,
  type UsersTableUser,
  type UsersTableLocation,
} from '@/components/users-table';

const ORG_ID = 1;

function makeUser(overrides: Partial<UsersTableUser> = {}): UsersTableUser {
  return {
    id: 100,
    email: 'pat@example.com',
    name: 'Pat Bowler',
    role: 'user',
    organizationId: ORG_ID,
    locationId: null,
    bowlerId: null,
    inviteToken: null,
    createdAt: '2026-01-01T00:00:00Z',
    linkedBowler: null,
    ...overrides,
  };
}

function renderTable(props: {
  users: UsersTableUser[];
  currentUser?: UsersTableUser;
  onResetPassword?: (id: number) => void;
  onDeleteUser?: (id: number) => void;
  orgLocations?: UsersTableLocation[];
}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <UsersTable
        users={props.users}
        currentUser={props.currentUser ?? makeUser({ id: 1, role: 'org_admin', name: 'Admin' })}
        orgLocations={props.orgLocations ?? []}
        onDeleteUser={props.onDeleteUser ?? (() => {})}
        onResetPassword={props.onResetPassword ?? (() => {})}
      />
    </QueryClientProvider>,
  );
}

describe('UsersTable — Reset Password button (task #423)', () => {
  it('renders the button for a normal user in the same org', () => {
    const target = makeUser({ id: 100, role: 'user', name: 'Pat Bowler' });
    renderTable({ users: [target] });
    expect(screen.getByTestId(`button-reset-password-${target.id}`)).toBeInTheDocument();
  });

  it('hides the button on the current admin\'s own row (endpoint refuses self-resets)', () => {
    const admin = makeUser({ id: 1, role: 'org_admin', name: 'Admin' });
    renderTable({ users: [admin], currentUser: admin });
    expect(screen.queryByTestId(`button-reset-password-${admin.id}`)).toBeNull();
  });

  it('hides the button on system_admin rows (dedicated tooling owns those rotations)', () => {
    const sysAdmin = makeUser({ id: 200, role: 'system_admin', name: 'Sys Admin' });
    renderTable({ users: [sysAdmin] });
    expect(screen.queryByTestId(`button-reset-password-${sysAdmin.id}`)).toBeNull();
  });

  it('still shows the button when the current user is undefined (e.g. while /api/user is loading)', () => {
    // Defensive: an undefined currentUser shouldn't accidentally
    // strip the action — the self-row guard is `id === currentUser?.id`,
    // which evaluates to `false` when currentUser is undefined.
    const target = makeUser({ id: 100, role: 'user' });
    renderTable({ users: [target], currentUser: undefined });
    expect(screen.getByTestId(`button-reset-password-${target.id}`)).toBeInTheDocument();
  });

  it('invokes onResetPassword with the user id when clicked', async () => {
    const onResetPassword = vi.fn();
    const target = makeUser({ id: 100, role: 'user' });
    renderTable({ users: [target], onResetPassword });
    await userEvent.click(screen.getByTestId(`button-reset-password-${target.id}`));
    expect(onResetPassword).toHaveBeenCalledTimes(1);
    expect(onResetPassword).toHaveBeenCalledWith(target.id);
  });

  it('shows the button alongside Resend Invite for a still-pending invitee', () => {
    // Regression pin: an admin should be able to BOTH resend the
    // invite and force-rotate the password on a pending invitee.
    // (e.g. the user gave up on the invite and the admin wants to
    // hand them a temporary password over the phone instead.)
    const pending = makeUser({
      id: 100,
      role: 'user',
      inviteToken: 'still-pending-token',
    });
    renderTable({ users: [pending] });
    expect(screen.getByTestId(`button-reset-password-${pending.id}`)).toBeInTheDocument();
    expect(screen.getByTitle(/resend invite email/i)).toBeInTheDocument();
  });
});
