import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Layout } from '@/components/layout';
import { ErrorBoundary } from '@/components/error-boundary';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
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

function invalidateJobQueries(jobId?: number) {
  queryClient.invalidateQueries({ queryKey: ['/api/payments-provider/apple-pay/jobs'] });
  if (jobId !== undefined) {
    queryClient.invalidateQueries({ queryKey: ['/api/payments-provider/apple-pay/jobs', jobId] });
  }
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

  const cancelMutation = useMutation({
    mutationFn: async () => apiRequest(`/api/payments-provider/apple-pay/jobs/${jobId}/cancel`, 'POST'),
    onSuccess: (resp) => {
      if (resp.success) {
        toast({ title: 'Job canceled', description: `Job #${jobId} has been canceled.` });
        invalidateJobQueries(jobId);
      } else {
        toast({ title: 'Could not cancel', description: resp.error?.message ?? 'Unknown error', variant: 'destructive' });
      }
    },
    onError: (err: unknown) => {
      toast({ title: 'Could not cancel', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    },
  });

  const retryMutation = useMutation({
    mutationFn: async () => apiRequest<{ resetCount: number }>(`/api/payments-provider/apple-pay/jobs/${jobId}/retry`, 'POST'),
    onSuccess: (resp) => {
      if (resp.success) {
        toast({
          title: 'Job retry queued',
          description: `Re-queued ${resp.data?.resetCount ?? 0} failed item(s).`,
        });
        invalidateJobQueries(jobId);
      } else {
        toast({ title: 'Could not retry', description: resp.error?.message ?? 'Unknown error', variant: 'destructive' });
      }
    },
    onError: (err: unknown) => {
      toast({ title: 'Could not retry', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    },
  });

  const itemRetryMutation = useMutation({
    mutationFn: async (itemId: number) =>
      apiRequest(`/api/payments-provider/apple-pay/jobs/${jobId}/items/${itemId}/retry`, 'POST'),
    onSuccess: (resp) => {
      if (resp.success) {
        toast({ title: 'Item retry queued' });
        invalidateJobQueries(jobId);
      } else {
        toast({ title: 'Could not retry item', description: resp.error?.message ?? 'Unknown error', variant: 'destructive' });
      }
    },
    onError: (err: unknown) => {
      toast({ title: 'Could not retry item', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    },
  });

  const canCancel = job ? isActive(job.status) : false;
  const canRetry = job ? isRetryable(job.status) : false;

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

  const { data: jobsResponse, isLoading, isError, error, refetch, isFetching } = useQuery<ApiResponse<{ jobs: ApplePayJob[] }>>({
    queryKey: ['/api/payments-provider/apple-pay/jobs'],
    refetchInterval: (query) => {
      const jobs = query.state.data?.data?.jobs ?? [];
      return jobs.some((j) => isActive(j.status)) ? 5000 : false;
    },
  });

  const jobs = jobsResponse?.data?.jobs ?? [];

  return (
    <Layout>
      <ErrorBoundary level="section">
        <div className="container py-6">
          <div className="mb-6">
            <h1 className="text-4xl font-bold">Apple Pay Jobs</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Bulk Apple Pay domain registration jobs. The latest 25 jobs are shown.
            </p>
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
                              <Badge variant={meta.variant}>{meta.label}</Badge>
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
