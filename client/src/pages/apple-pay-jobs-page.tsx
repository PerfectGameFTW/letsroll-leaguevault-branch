import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '@/components/layout';
import { ErrorBoundary } from '@/components/error-boundary';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
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
};

const ITEM_STATUS_META: Record<ApplePayJobItemStatus, { label: string; variant: BadgeVariant }> = {
  pending: { label: 'Pending', variant: 'outline' },
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

interface JobDetailResponse {
  job: ApplePayJob;
  counts: {
    total: number;
    succeeded: number;
    failed: number;
    skipped: number;
    pending: number;
  };
  items: ApplePayJobItem[];
}

function JobDetailDialog({ jobId, onClose }: { jobId: number; onClose: () => void }) {
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

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Domain</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead>Processed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                        No items recorded for this job.
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((item) => {
                      const meta = ITEM_STATUS_META[item.status as ApplePayJobItemStatus] ?? ITEM_STATUS_META.pending;
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
