import type { DeletionExecutionSummary, DeletionRequestStatus } from '@shared/schema';

export type ReviewMode = 'completed' | 'rejected' | 'execute';

export const STATUS_LABELS: Record<DeletionRequestStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'Pending', variant: 'default' },
  completed: { label: 'Completed', variant: 'secondary' },
  rejected: { label: 'Rejected', variant: 'outline' },
};

export function formatDate(value: string | null): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

/**
 * The deletion-requests row stores `executionSummary` as a
 * JSON-serialized string in a TEXT column. Parse defensively AND
 * normalize the shape so a malformed legacy row (or a row written by
 * an older version of the executor with missing fields) never throws
 * inside the panel's array `.filter` / `.map` calls.
 */
export function parseExecutionSummary(raw: string | null): DeletionExecutionSummary | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  const user = (p.user && typeof p.user === 'object' ? p.user : {}) as Record<string, unknown>;
  // Task #349: confirmationEmail is optional — older audit summaries
  // (written before this task) won't have it, and the panel renders a
  // neutral "unknown" pill in that case. Keep the field undefined
  // rather than synthesizing a default so the panel can tell the
  // difference between "we wrote a record saying we sent it" and
  // "this row predates the field".
  let confirmationEmail: DeletionExecutionSummary['confirmationEmail'];
  if (p.confirmationEmail && typeof p.confirmationEmail === 'object') {
    const ce = p.confirmationEmail as Record<string, unknown>;
    confirmationEmail = {
      sent: ce.sent === true,
      suppressedByUser: ce.suppressedByUser === true,
      error: typeof ce.error === 'string' ? ce.error : undefined,
    };
  }
  return {
    executedAt: typeof p.executedAt === 'string' ? p.executedAt : '',
    executedBy: typeof p.executedBy === 'number' ? p.executedBy : 0,
    email: typeof p.email === 'string' ? p.email : '',
    user: {
      deleted: user.deleted === true,
      userId: typeof user.userId === 'number' ? user.userId : null,
      reason: typeof user.reason === 'string' ? user.reason : undefined,
    },
    bowlers: Array.isArray(p.bowlers)
      ? (p.bowlers.filter((b) => b && typeof b === 'object') as DeletionExecutionSummary['bowlers'])
      : [],
    paymentProvider: Array.isArray(p.paymentProvider)
      ? (p.paymentProvider.filter(
          (x) => x && typeof x === 'object',
        ) as DeletionExecutionSummary['paymentProvider'])
      : [],
    emailChangeRequestsDeleted:
      typeof p.emailChangeRequestsDeleted === 'number' ? p.emailChangeRequestsDeleted : 0,
    confirmationEmail,
  };
}
