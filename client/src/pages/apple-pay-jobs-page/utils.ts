import { invalidateApplePayJobQueries } from '@/lib/query-keys';
import type {
  ApplePayJob,
  ApplePayJobItem,
  ApplePayJobItemStatus,
  ApplePayJobStatus,
} from '@shared/schema';

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

export const JOB_STATUS_META: Record<ApplePayJobStatus, { label: string; variant: BadgeVariant }> = {
  pending: { label: 'Pending', variant: 'outline' },
  running: { label: 'Running', variant: 'default' },
  succeeded: { label: 'Succeeded', variant: 'secondary' },
  failed: { label: 'Failed', variant: 'destructive' },
  partial: { label: 'Partial', variant: 'default' },
  canceled: { label: 'Canceled', variant: 'outline' },
};

export const ITEM_STATUS_META: Record<ApplePayJobItemStatus, { label: string; variant: BadgeVariant }> = {
  pending: { label: 'Pending', variant: 'outline' },
  processing: { label: 'Processing', variant: 'default' },
  succeeded: { label: 'Succeeded', variant: 'secondary' },
  failed: { label: 'Failed', variant: 'destructive' },
  skipped: { label: 'Skipped', variant: 'outline' },
};

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function isActive(status: string): boolean {
  return status === 'pending' || status === 'running';
}

export function isRetryable(status: string): boolean {
  return status === 'failed' || status === 'partial' || status === 'canceled';
}

export function isTerminal(status: string): boolean {
  return (
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'partial' ||
    status === 'canceled'
  );
}

// Thin re-export of the shared registry helper (Task #767) so existing
// call sites keep the familiar name while the keys/invalidation logic live
// in one place. Refreshes the listing, the affected job's detail, and the
// sidebar attention badge (#313).
export function invalidateJobQueries(jobId?: number) {
  invalidateApplePayJobQueries(jobId);
}

export interface JobDetailResponse {
  job: ApplePayJob;
  counts: {
    total: number;
    succeeded: number;
    failed: number;
    skipped: number;
    pending: number;
  };
  // Sum of recoveredCount across all items in this job. > 0 means at least
  // one item's pre-call lease expired and recovery had to revive it — an
  // anomaly worth flagging to the operator (#270).
  recoveredItemCount?: number;
  items: ApplePayJobItem[];
}
