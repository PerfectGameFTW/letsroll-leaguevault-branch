import { Fragment, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Layout } from '@/components/layout';
import { ErrorBoundary } from '@/components/error-boundary';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import type {
  ApiResponse,
  DeletionRequest,
  DeletionRequestStatus,
  DeletionExecutionSummary,
} from '@shared/schema';

type ReviewMode = 'completed' | 'rejected' | 'execute';

const STATUS_LABELS: Record<DeletionRequestStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'Pending', variant: 'default' },
  completed: { label: 'Completed', variant: 'secondary' },
  rejected: { label: 'Rejected', variant: 'outline' },
};

function formatDate(value: string | null): string {
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
function parseExecutionSummary(raw: string | null): DeletionExecutionSummary | null {
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
  };
}

function ExecutionSummaryPanel({ summary }: { summary: DeletionExecutionSummary }) {
  const bowlersDone = summary.bowlers.filter((b) => b.anonymized).length;
  const bowlersFailed = summary.bowlers.filter((b) => !b.anonymized);
  const providersDone = summary.paymentProvider.filter((p) => p.deleted).length;
  const providersFailed = summary.paymentProvider.filter((p) => !p.deleted);

  return (
    <div className="rounded-md border bg-muted/30 p-4 space-y-4 text-sm" data-testid="execution-summary-panel">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        <div>
          <span className="text-muted-foreground">Executed at: </span>
          <span className="font-medium">{formatDate(summary.executedAt)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Executed by user ID: </span>
          <span className="font-medium">{summary.executedBy}</span>
        </div>
        <div>
          <span className="text-muted-foreground">User account: </span>
          {summary.user.deleted ? (
            <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> deleted (id {summary.user.userId})
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              {summary.user.reason || 'not deleted'}
            </span>
          )}
        </div>
        <div>
          <span className="text-muted-foreground">Pending email-change requests removed: </span>
          <span className="font-medium">{summary.emailChangeRequestsDeleted}</span>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <h4 className="font-semibold">Bowler records</h4>
          <span className="text-xs text-muted-foreground">
            {bowlersDone} of {summary.bowlers.length} anonymized
          </span>
        </div>
        {summary.bowlers.length === 0 ? (
          <p className="text-xs text-muted-foreground">No bowler records were matched for this email.</p>
        ) : bowlersFailed.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            All matching bowler records were anonymized successfully.
          </p>
        ) : (
          <ul className="space-y-1">
            {bowlersFailed.map((b) => (
              <li
                key={b.bowlerId}
                className="text-xs text-destructive flex items-start gap-2"
                data-testid={`bowler-failed-${b.bowlerId}`}
              >
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  Bowler #{b.bowlerId}: failed to anonymize
                  {b.reason ? ` — ${b.reason}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <h4 className="font-semibold">Payment-provider customer records</h4>
          <span className="text-xs text-muted-foreground">
            {providersDone} of {summary.paymentProvider.length} deleted
          </span>
        </div>
        {summary.paymentProvider.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No payment-provider customer records were associated with these bowlers.
          </p>
        ) : (
          <ul className="space-y-1">
            {summary.paymentProvider.map((p, i) => (
              <li
                key={`${p.locationId}-${p.customerId}-${i}`}
                className={`text-xs flex items-start gap-2 ${p.deleted ? 'text-muted-foreground' : 'text-destructive'}`}
                data-testid={p.deleted ? `provider-ok-${i}` : `provider-failed-${i}`}
              >
                {p.deleted ? (
                  <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                )}
                <span>
                  <span className="font-mono">{p.providerName}</span> · location {p.locationId} ·
                  customer <span className="font-mono">{p.customerId}</span>
                  {p.deleted ? ' — deleted' : ` — failed${p.error ? `: ${p.error}` : ''}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {providersFailed.length > 0 && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            Follow up manually with the listed payment processor(s) to confirm the customer
            record is gone.
          </p>
        )}
      </div>
    </div>
  );
}

export default function DeletionRequestsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<DeletionRequestStatus>('pending');
  const [activeRequest, setActiveRequest] = useState<DeletionRequest | null>(null);
  const [reviewMode, setReviewMode] = useState<ReviewMode>('completed');
  const [adminNote, setAdminNote] = useState('');
  const [executeConfirmText, setExecuteConfirmText] = useState('');
  const [expandedRequestIds, setExpandedRequestIds] = useState<Set<number>>(new Set());

  const toggleExpanded = (id: number) => {
    setExpandedRequestIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const { data: requestsResponse, isLoading } = useQuery<ApiResponse<DeletionRequest[]>>({
    queryKey: ['/api/system-admin/deletion-requests', statusFilter],
    queryFn: async () => {
      const r = await fetch(`/api/system-admin/deletion-requests?status=${statusFilter}`, {
        credentials: 'include',
      });
      if (!r.ok) throw new Error('Failed to fetch deletion requests');
      return r.json();
    },
  });

  const requests = requestsResponse?.data ?? [];

  const reviewMutation = useMutation({
    mutationFn: async (vars: { id: number; status: ReviewMode; adminNote: string | null }) => {
      return apiRequest(`/api/system-admin/deletion-requests/${vars.id}`, 'PATCH', {
        status: vars.status,
        adminNote: vars.adminNote,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/system-admin/deletion-requests'] });
      queryClient.invalidateQueries({ queryKey: ['/api/system-admin/deletion-requests/pending-count'] });
      setActiveRequest(null);
      setAdminNote('');
      toast({ title: 'Request updated', description: 'The deletion request has been updated.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to update request', description: error.message, variant: 'destructive' });
    },
  });

  const executeMutation = useMutation({
    mutationFn: async (vars: { id: number; adminNote: string | null }) => {
      return apiRequest(`/api/system-admin/deletion-requests/${vars.id}/execute`, 'POST', {
        confirm: 'DELETE',
        adminNote: vars.adminNote,
      }) as Promise<ApiResponse<{ request: DeletionRequest; summary: DeletionExecutionSummary }>>;
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['/api/system-admin/deletion-requests'] });
      setActiveRequest(null);
      setAdminNote('');
      setExecuteConfirmText('');
      const summary = response?.data?.summary;
      const bowlersDone = summary?.bowlers.filter((b) => b.anonymized).length ?? 0;
      const providersDone = summary?.paymentProvider.filter((p) => p.deleted).length ?? 0;
      const userDone = summary?.user.deleted ? 'user account removed' : 'no user account found';
      toast({
        title: 'Account data deleted',
        description: `${bowlersDone} bowler record(s) anonymized, ${providersDone} payment-provider customer(s) removed, ${userDone}.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Deletion failed', description: error.message, variant: 'destructive' });
    },
  });

  const openReview = (req: DeletionRequest, mode: ReviewMode) => {
    setActiveRequest(req);
    setReviewMode(mode);
    setAdminNote(req.adminNote ?? '');
    setExecuteConfirmText('');
  };

  return (
    <Layout>
      <ErrorBoundary level="section">
        <div className="container py-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-4xl font-bold">Deletion Requests</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Account deletion requests submitted from the public delete-account page.
              </p>
            </div>
          </div>

          <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as DeletionRequestStatus)} className="mb-4">
            <TabsList>
              <TabsTrigger value="pending">Pending</TabsTrigger>
              <TabsTrigger value="completed">Completed</TabsTrigger>
              <TabsTrigger value="rejected">Rejected</TabsTrigger>
            </TabsList>
          </Tabs>

          <Card>
            <CardHeader>
              <CardTitle>{STATUS_LABELS[statusFilter].label} requests ({requests.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : requests.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  No {statusFilter} deletion requests.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Submitted</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Reviewed</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {requests.map((req) => {
                        const meta = STATUS_LABELS[req.status as DeletionRequestStatus] ?? STATUS_LABELS.pending;
                        const summary = parseExecutionSummary(req.executionSummary);
                        const expanded = expandedRequestIds.has(req.id);
                        const providerFailures = summary?.paymentProvider.filter((p) => !p.deleted).length ?? 0;
                        return (
                          <Fragment key={req.id}>
                              <TableRow data-testid={`deletion-request-row-${req.id}`}>
                                <TableCell className="font-medium">{req.email}</TableCell>
                                <TableCell className="whitespace-nowrap">{formatDate(req.createdAt)}</TableCell>
                                <TableCell className="max-w-xs">
                                  <span className="line-clamp-2 text-sm text-muted-foreground">
                                    {req.reason || '—'}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <Badge variant={meta.variant}>{meta.label}</Badge>
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                                  {req.reviewedAt ? formatDate(req.reviewedAt) : '—'}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex gap-2 justify-end flex-wrap items-center">
                                    {req.status === 'pending' ? (
                                      <>
                                        <Button
                                          size="sm"
                                          variant="destructive"
                                          onClick={() => openReview(req, 'execute')}
                                        >
                                          Delete account data
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => openReview(req, 'completed')}
                                        >
                                          Mark completed
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => openReview(req, 'rejected')}
                                        >
                                          Reject
                                        </Button>
                                      </>
                                    ) : req.adminNote ? (
                                      <span className="text-xs text-muted-foreground italic">{req.adminNote}</span>
                                    ) : null}
                                    {summary && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        data-testid={`toggle-summary-${req.id}`}
                                        aria-expanded={expanded}
                                        aria-label={expanded ? 'Hide execution details' : 'Show execution details'}
                                        onClick={() => toggleExpanded(req.id)}
                                      >
                                        {expanded ? (
                                          <ChevronDown className="h-4 w-4" />
                                        ) : (
                                          <ChevronRight className="h-4 w-4" />
                                        )}
                                        <span className="ml-1 text-xs">
                                          Execution details
                                          {providerFailures > 0 && (
                                            <Badge
                                              variant="destructive"
                                              className="ml-2 px-1.5 py-0 text-[10px]"
                                            >
                                              {providerFailures} failed
                                            </Badge>
                                          )}
                                        </span>
                                      </Button>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                              {expanded && summary && (
                                <TableRow
                                  data-testid={`deletion-request-summary-row-${req.id}`}
                                  className="bg-transparent hover:bg-transparent"
                                >
                                  <TableCell colSpan={6} className="p-3">
                                    <ExecutionSummaryPanel summary={summary} />
                                  </TableCell>
                                </TableRow>
                              )}
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Dialog
            open={!!activeRequest}
            onOpenChange={(open) => {
              if (!open) {
                setActiveRequest(null);
                setAdminNote('');
                setExecuteConfirmText('');
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {reviewMode === 'execute'
                    ? 'Delete account data'
                    : reviewMode === 'completed'
                    ? 'Mark request completed'
                    : 'Reject request'}
                </DialogTitle>
                <DialogDescription>
                  {reviewMode === 'execute' ? (
                    <>
                      This will permanently anonymize every bowler record matching{' '}
                      <span className="font-mono">{activeRequest?.email}</span>, delete the
                      associated user account, and best-effort remove the customer record at
                      every configured payment provider. Historical scores, league memberships,
                      and payment rows are preserved with PII scrubbed.
                      <br />
                      <strong>This action cannot be undone.</strong> Type{' '}
                      <span className="font-mono font-semibold">DELETE</span> below to confirm.
                    </>
                  ) : reviewMode === 'completed' ? (
                    <>
                      Confirm that you have processed the deletion request for{' '}
                      {activeRequest?.email}. This does not automatically delete user data —
                      perform any required deletions in your storage backend before marking
                      complete, or use "Delete account data" instead.
                    </>
                  ) : (
                    <>Reject the deletion request for {activeRequest?.email}. Add a note explaining why.</>
                  )}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                {reviewMode === 'execute' && (
                  <div className="space-y-2">
                    <Label htmlFor="execute-confirm">Type DELETE to confirm</Label>
                    <input
                      id="execute-confirm"
                      type="text"
                      className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      value={executeConfirmText}
                      onChange={(e) => setExecuteConfirmText(e.target.value)}
                      placeholder="DELETE"
                      autoComplete="off"
                    />
                  </div>
                )}
                <Label htmlFor="admin-note">Admin note (optional)</Label>
                <Textarea
                  id="admin-note"
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  placeholder="Internal note about this decision"
                  rows={3}
                />
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setActiveRequest(null);
                    setAdminNote('');
                    setExecuteConfirmText('');
                  }}
                >
                  Cancel
                </Button>
                {reviewMode === 'execute' ? (
                  <Button
                    variant="destructive"
                    disabled={executeMutation.isPending || executeConfirmText !== 'DELETE'}
                    onClick={() =>
                      activeRequest &&
                      executeMutation.mutate({
                        id: activeRequest.id,
                        adminNote: adminNote.trim() ? adminNote.trim() : null,
                      })
                    }
                  >
                    {executeMutation.isPending ? 'Deleting...' : 'Delete account data'}
                  </Button>
                ) : (
                  <Button
                    variant={reviewMode === 'rejected' ? 'destructive' : 'default'}
                    disabled={reviewMutation.isPending}
                    onClick={() =>
                      activeRequest &&
                      reviewMutation.mutate({
                        id: activeRequest.id,
                        status: reviewMode,
                        adminNote: adminNote.trim() ? adminNote.trim() : null,
                      })
                    }
                  >
                    {reviewMutation.isPending ? 'Saving...' : reviewMode === 'completed' ? 'Mark completed' : 'Reject'}
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </ErrorBoundary>
    </Layout>
  );
}
