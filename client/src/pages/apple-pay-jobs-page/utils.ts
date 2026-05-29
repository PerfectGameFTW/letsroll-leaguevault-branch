import { queryClient } from '@/lib/queryClient';
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

export function invalidateJobQueries(jobId?: number) {
  queryClient.invalidateQueries({ queryKey: ['/api/payments-provider/apple-pay/jobs'] });
  if (jobId !== undefined) {
    queryClient.invalidateQueries({ queryKey: ['/api/payments-provider/apple-pay/jobs', jobId] });
  }
  // Refresh the sidebar badge so it clears the moment a cancel/retry
  // moves the queue out of an attention-needing state (#313). Note: the
  // listing key above (`['/api/payments-provider/apple-pay/jobs']`) is a
  // prefix of the pending-count key, so by default React Query would
  // refetch this through prefix matching — but we invalidate it
  // explicitly here so this guarantee survives any future refactor that
  // narrows the listing key.
  queryClient.invalidateQueries({
    queryKey: ['/api/payments-provider/apple-pay/jobs/pending-count'],
  });
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
