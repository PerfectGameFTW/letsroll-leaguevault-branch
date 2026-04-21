import { useState } from 'react';
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
import type { ApiResponse, DeletionRequest, DeletionRequestStatus } from '@shared/schema';

type ReviewMode = 'completed' | 'rejected';

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

export default function DeletionRequestsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<DeletionRequestStatus>('pending');
  const [activeRequest, setActiveRequest] = useState<DeletionRequest | null>(null);
  const [reviewMode, setReviewMode] = useState<ReviewMode>('completed');
  const [adminNote, setAdminNote] = useState('');

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

  const openReview = (req: DeletionRequest, mode: ReviewMode) => {
    setActiveRequest(req);
    setReviewMode(mode);
    setAdminNote(req.adminNote ?? '');
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
                        return (
                          <TableRow key={req.id}>
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
                              {req.status === 'pending' ? (
                                <div className="flex gap-2 justify-end">
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
                                </div>
                              ) : req.adminNote ? (
                                <span className="text-xs text-muted-foreground italic">{req.adminNote}</span>
                              ) : null}
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

          <Dialog open={!!activeRequest} onOpenChange={(open) => { if (!open) { setActiveRequest(null); setAdminNote(''); } }}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {reviewMode === 'completed' ? 'Mark request completed' : 'Reject request'}
                </DialogTitle>
                <DialogDescription>
                  {reviewMode === 'completed'
                    ? `Confirm that you have processed the deletion request for ${activeRequest?.email}. This does not automatically delete user data — perform any required deletions in your storage backend before marking complete.`
                    : `Reject the deletion request for ${activeRequest?.email}. Add a note explaining why.`}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
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
                <Button variant="outline" onClick={() => { setActiveRequest(null); setAdminNote(''); }}>
                  Cancel
                </Button>
                <Button
                  variant={reviewMode === 'rejected' ? 'destructive' : 'default'}
                  disabled={reviewMutation.isPending}
                  onClick={() => activeRequest && reviewMutation.mutate({
                    id: activeRequest.id,
                    status: reviewMode,
                    adminNote: adminNote.trim() ? adminNote.trim() : null,
                  })}
                >
                  {reviewMutation.isPending ? 'Saving...' : (reviewMode === 'completed' ? 'Mark completed' : 'Reject')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </ErrorBoundary>
    </Layout>
  );
}
