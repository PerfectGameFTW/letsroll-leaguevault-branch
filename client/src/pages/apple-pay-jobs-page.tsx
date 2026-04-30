import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearch, useLocation } from 'wouter';
import { Layout } from '@/components/layout';
import { ErrorBoundary } from '@/components/error-boundary';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { apiRequest, queryClient } from '@/lib/queryClient';
import {
  isProviderNotConfiguredError,
  providerNotConfiguredToast,
} from '@/lib/provider-not-configured';
import { useToast } from '@/hooks/use-toast';
import { usePaymentProvider } from '@/hooks/use-payment-provider';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ApiResponse, ApplePayJob, ApplePayJobItem, ApplePayJobStatus, ApplePayJobItemStatus } from '@shared/schema';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

const JOB_STATUS_META: Record<ApplePayJobStatus, { label: string; variant: BadgeVariant }> = {
  pending: { label: 'Pending', variant: 'outline' },
  running: { label: 'Running', variant: 'default' },
  succeeded: { label: 'Succeeded', variant: 'secondary' },
  failed: { label: 'Failed', variant: 'destructive' },
  partial: { label: 'Partial', variant: 'default' },
  canceled: { label: 'Canceled', variant: 'outline' },
};

const ITEM_STATUS_META: Record<ApplePayJobItemStatus, { label: string; variant: BadgeVariant }> = {
  pending: { label: 'Pending', variant: 'outline' },
  processing: { label: 'Processing', variant: 'default' },
  succeeded: { label: 'Succeeded', variant: 'secondary' },
  failed: { label: 'Failed', variant: 'destructive' },
  skipped: { label: 'Skipped', variant: 'outline' },
};

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function isActive(status: string): boolean {
  return status === 'pending' || status === 'running';
}

function isRetryable(status: string): boolean {
  return status === 'failed' || status === 'partial' || status === 'canceled';
}

function isTerminal(status: string): boolean {
  return (
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'partial' ||
    status === 'canceled'
  );
}

function invalidateJobQueries(jobId?: number) {
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

interface JobDetailResponse {
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

function JobDetailDialog({ jobId, onClose }: { jobId: number; onClose: () => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<ApiResponse<JobDetailResponse>>({
    queryKey: ['/api/payments-provider/apple-pay/jobs', jobId],
    queryFn: async () => {
      const r = await fetch(`/api/payments-provider/apple-pay/jobs/${jobId}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!r.ok) throw new Error('Failed to fetch job');
      return r.json();
    },
    refetchInterval: (query) => {
      const status = query.state.data?.data?.job?.status;
      return status && isActive(status) ? 3000 : false;
    },
  });

  const detail = data?.data;
  const job = detail?.job;
  const counts = detail?.counts;
  const items = detail?.items ?? [];
  const recoveredItemCount = detail?.recoveredItemCount ?? 0;

  // Centralised PROVIDER_NOT_CONFIGURED handling for the three
  // Apple-Pay job mutations (#391). The job itself spans multiple
  // locations, but if every item in the job is bound to the same
  // location we can deep-link the actionable toast to that one
  // location's settings entry. Otherwise we fall back to the
  // generic /integrations route.
  const jobLocationId = (() => {
    if (items.length === 0) return null;
    const first = items[0]?.locationId ?? null;
    if (first == null) return null;
    return items.every((it) => it.locationId === first) ? first : null;
  })();

  // Look up the active provider for the job's owning location so the
  // PROVIDER_NOT_CONFIGURED toast names "Clover" instead of always
  // saying "Square" on Clover-only locations (task #610). When a job
  // spans multiple locations `jobLocationId` is null and the toast
  // falls back to the legacy Square copy + bare /integrations link,
  // which is the only signal we can give without picking a winner.
  const { isClover } = usePaymentProvider(jobLocationId);
  const provider = isClover ? 'clover' : 'square';

  const handleMutationError = (titleFallback: string) => (err: unknown) => {
    if (isProviderNotConfiguredError(err)) {
      toast(providerNotConfiguredToast({ navigate, locationId: jobLocationId, provider }));
      return;
    }
    toast({
      title: titleFallback,
      description: err instanceof Error ? err.message : 'Unknown error',
      variant: 'destructive',
    });
  };

  const handleMutationResp = (
    resp: { success: boolean; error?: { message?: string; code?: string } },
    titleFallback: string,
  ): boolean => {
    if (resp.success) return true;
    if (resp.error?.code === 'PROVIDER_NOT_CONFIGURED') {
      toast(providerNotConfiguredToast({ navigate, locationId: jobLocationId, provider }));
    } else {
      toast({ title: titleFallback, description: resp.error?.message ?? 'Unknown error', variant: 'destructive' });
    }
    return false;
  };

  const cancelMutation = useMutation({
    mutationFn: async () => apiRequest(`/api/payments-provider/apple-pay/jobs/${jobId}/cancel`, 'POST'),
    onSuccess: (resp) => {
      if (handleMutationResp(resp, 'Could not cancel')) {
        toast({ title: 'Job canceled', description: `Job #${jobId} has been canceled.` });
        invalidateJobQueries(jobId);
      }
    },
    onError: handleMutationError('Could not cancel'),
  });

  const retryMutation = useMutation({
    mutationFn: async () => apiRequest<{ resetCount: number }>(`/api/payments-provider/apple-pay/jobs/${jobId}/retry`, 'POST'),
    onSuccess: (resp) => {
      if (handleMutationResp(resp, 'Could not retry')) {
        toast({
          title: 'Job retry queued',
          description: `Re-queued ${resp.data?.resetCount ?? 0} failed item(s).`,
        });
        invalidateJobQueries(jobId);
      }
    },
    onError: handleMutationError('Could not retry'),
  });

  const itemRetryMutation = useMutation({
    mutationFn: async (itemId: number) =>
      apiRequest(`/api/payments-provider/apple-pay/jobs/${jobId}/items/${itemId}/retry`, 'POST'),
    onSuccess: (resp) => {
      if (handleMutationResp(resp, 'Could not retry item')) {
        toast({ title: 'Item retry queued' });
        invalidateJobQueries(jobId);
      }
    },
    onError: handleMutationError('Could not retry item'),
  });

  // Hard-delete a terminal job + its items (FK ON DELETE CASCADE removes
  // the items). Backend pins this to terminal jobs only — active jobs
  // must be canceled first or the worker would race the delete.
  const deleteMutation = useMutation({
    mutationFn: async () => apiRequest(`/api/payments-provider/apple-pay/jobs/${jobId}`, 'DELETE'),
    onSuccess: (resp) => {
      if (handleMutationResp(resp, 'Could not delete')) {
        toast({ title: 'Job deleted', description: `Job #${jobId} has been deleted.` });
        invalidateJobQueries(jobId);
        // Drop the now-stale per-job detail cache so a re-open of the same
        // id (very unlikely after delete, but possible if the user navigates
        // back via a deep link) refetches and lands on the 404 path.
        queryClient.removeQueries({ queryKey: ['/api/payments-provider/apple-pay/jobs', jobId] });
        onClose();
      }
    },
    onError: handleMutationError('Could not delete'),
  });

  const canCancel = job ? isActive(job.status) : false;
  const canRetry = job ? isRetryable(job.status) : false;
  const canDelete = job ? isTerminal(job.status) : false;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Job #{jobId}</DialogTitle>
          <DialogDescription>
            {job ? (
              <>Started {formatDate(job.startedAt)} • Completed {formatDate(job.completedAt)}</>
            ) : (
              'Loading job details…'
            )}
          </DialogDescription>
        </DialogHeader>

        {isError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <p className="text-destructive font-medium">Failed to load job details.</p>
            <p className="text-muted-foreground mt-1">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? 'Retrying…' : 'Retry'}
            </Button>
          </div>
        ) : isLoading || !job || !counts ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={JOB_STATUS_META[job.status as ApplePayJobStatus]?.variant ?? 'outline'}>
                {JOB_STATUS_META[job.status as ApplePayJobStatus]?.label ?? job.status}
              </Badge>
              {isActive(job.status) && (
                <span className="text-xs text-muted-foreground">Refreshing every 3s…</span>
              )}
              <div className="ml-auto flex flex-wrap gap-2">
                {canCancel && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (window.confirm(`Cancel job #${jobId}? In-flight item registrations will finish; the worker will stop picking up new ones within a few seconds.`)) {
                        cancelMutation.mutate();
                      }
                    }}
                    disabled={cancelMutation.isPending}
                    data-testid="button-cancel-job"
                  >
                    {cancelMutation.isPending ? 'Canceling…' : 'Cancel job'}
                  </Button>
                )}
                {canRetry && counts.failed > 0 && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => retryMutation.mutate()}
                    disabled={retryMutation.isPending}
                    data-testid="button-retry-job"
                  >
                    {retryMutation.isPending ? 'Retrying…' : `Retry ${counts.failed} failed item${counts.failed === 1 ? '' : 's'}`}
                  </Button>
                )}
                {canDelete && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete job #${jobId}? This permanently removes the job and its ${items.length} item${items.length === 1 ? '' : 's'}. This cannot be undone.`,
                        )
                      ) {
                        deleteMutation.mutate();
                      }
                    }}
                    disabled={deleteMutation.isPending}
                    data-testid="button-delete-job"
                  >
                    {deleteMutation.isPending ? 'Deleting…' : 'Delete job'}
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <CountTile label="Total" value={counts.total} />
              <CountTile label="Succeeded" value={counts.succeeded} tone="success" />
              <CountTile label="Failed" value={counts.failed} tone="danger" />
              <CountTile label="Skipped" value={counts.skipped} />
              <CountTile label="Pending" value={counts.pending} />
            </div>

            {job.errorMessage && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                {job.errorMessage}
              </div>
            )}

            {recoveredItemCount > 0 && (
              <div
                className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200"
                data-testid="banner-recovered-items"
              >
                <p className="font-medium">Anomaly: {recoveredItemCount} item{recoveredItemCount === 1 ? '' : 's'} recovered after stalling mid-call</p>
                <p className="text-xs mt-1 opacity-80">
                  Their pre-call lease expired before the worker wrote a result, so recovery re-queued them.
                  This usually means the previous worker crashed or the provider call hung. Look for "Revived stalled items" warnings in the server logs.
                </p>
              </div>
            )}

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Domain</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead>Processed</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                        No items recorded for this job.
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((item) => {
                      const meta = ITEM_STATUS_META[item.status as ApplePayJobItemStatus] ?? ITEM_STATUS_META.pending;
                      // Item retry is only safe when the parent job is terminal —
                      // otherwise the worker's preloaded pending queue would skip
                      // the reset row. Backend enforces this too.
                      const itemRetryable = item.status === 'failed' && canRetry;
                      const isThisItemRetrying = itemRetryMutation.isPending && itemRetryMutation.variables === item.id;
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.domain}</TableCell>
                          <TableCell>
                            <Badge variant={meta.variant}>{meta.label}</Badge>
                          </TableCell>
                          <TableCell className="max-w-md">
                            <span className="text-sm text-muted-foreground line-clamp-3">
                              {item.message || '—'}
                            </span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {formatDate(item.processedAt)}
                          </TableCell>
                          <TableCell className="text-right">
                            {itemRetryable ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => itemRetryMutation.mutate(item.id)}
                                disabled={itemRetryMutation.isPending}
                                data-testid={`button-retry-item-${item.id}`}
                              >
                                {isThisItemRetrying ? 'Retrying…' : 'Retry'}
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CountTile({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'danger' }) {
  const toneClass = tone === 'success'
    ? 'text-emerald-600'
    : tone === 'danger'
      ? 'text-destructive'
      : 'text-foreground';
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

export default function ApplePayJobsPage() {
  const [activeJobId, setActiveJobId] = useState<number | null>(null);

  // Optional `?jobs=1,2,3` filter. Used by the dashboard recovery
  // banner (#272) to deep-link admins straight to the jobs that just
  // triggered an alert. Invalid / missing values fall back to "show all".
  const search = useSearch();
  const filteredJobIds = useMemo(() => {
    const params = new URLSearchParams(search);
    const raw = params.get('jobs');
    if (!raw) return null;
    const ids = raw
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    return ids.length > 0 ? new Set(ids) : null;
  }, [search]);

  // Each job is augmented server-side with `recoveredItemCount` so the
  // list view can flag anomalous jobs (#270) without per-row fetches.
  const { data: jobsResponse, isLoading, isError, error, refetch, isFetching } = useQuery<ApiResponse<{ jobs: Array<ApplePayJob & { recoveredItemCount?: number }> }>>({
    queryKey: ['/api/payments-provider/apple-pay/jobs'],
    refetchInterval: (query) => {
      const jobs = query.state.data?.data?.jobs ?? [];
      return jobs.some((j) => isActive(j.status)) ? 5000 : false;
    },
  });

  const allJobs = jobsResponse?.data?.jobs ?? [];
  const jobs = filteredJobIds
    ? allJobs.filter((j) => filteredJobIds.has(j.id))
    : allJobs;

  return (
    <Layout>
      <ErrorBoundary level="section">
        <div className="container py-6">
          <div className="mb-6">
            <h1 className="text-4xl font-bold">Apple Pay Jobs</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Bulk Apple Pay domain registration jobs. The latest 25 jobs are shown.
            </p>
            {filteredJobIds && (
              <div
                className="mt-3 inline-flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-900 dark:text-amber-200"
                data-testid="banner-jobs-filter-active"
              >
                <span>
                  Filtered to {jobs.length} job{jobs.length === 1 ? '' : 's'} from a recovery alert
                </span>
                <a
                  href="/admin/apple-pay-jobs"
                  className="font-semibold underline underline-offset-2 hover:opacity-80"
                  data-testid="link-clear-jobs-filter"
                >
                  Clear filter
                </a>
              </div>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recent jobs ({jobs.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {isError ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
                  <p className="text-destructive font-medium">Failed to load jobs.</p>
                  <p className="text-muted-foreground mt-1">
                    {error instanceof Error ? error.message : 'Unknown error'}
                  </p>
                  <Button size="sm" variant="outline" className="mt-3" onClick={() => refetch()} disabled={isFetching}>
                    {isFetching ? 'Retrying…' : 'Retry'}
                  </Button>
                </div>
              ) : isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : jobs.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  No jobs yet. Trigger a bulk Apple Pay registration to see jobs here.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Job</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Succeeded</TableHead>
                        <TableHead className="text-right">Failed</TableHead>
                        <TableHead className="text-right">Skipped</TableHead>
                        <TableHead>Started</TableHead>
                        <TableHead>Completed</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {jobs.map((job) => {
                        const meta = JOB_STATUS_META[job.status as ApplePayJobStatus] ?? { label: job.status, variant: 'outline' as const };
                        return (
                          <TableRow key={job.id}>
                            <TableCell className="font-medium">#{job.id}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap items-center gap-1">
                                <Badge variant={meta.variant}>{meta.label}</Badge>
                                {(job.recoveredItemCount ?? 0) > 0 && (
                                  <Badge
                                    variant="outline"
                                    className="border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200"
                                    title={`${job.recoveredItemCount} item${job.recoveredItemCount === 1 ? '' : 's'} were recovered after stalling mid-call`}
                                    data-testid={`badge-lease-anomaly-${job.id}`}
                                  >
                                    Lease anomaly
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">{job.totalDomains}</TableCell>
                            <TableCell className="text-right text-emerald-600">{job.succeededCount}</TableCell>
                            <TableCell className="text-right text-destructive">{job.failedCount}</TableCell>
                            <TableCell className="text-right">{job.skippedCount}</TableCell>
                            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                              {formatDate(job.startedAt)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                              {formatDate(job.completedAt)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button size="sm" variant="outline" onClick={() => setActiveJobId(job.id)}>
                                View
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {activeJobId !== null && (
            <JobDetailDialog jobId={activeJobId} onClose={() => setActiveJobId(null)} />
          )}
        </div>
      </ErrorBoundary>
    </Layout>
  );
}
