import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Layout } from '@/components/layout';
import { ErrorBoundary } from '@/components/error-boundary';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Plus } from 'lucide-react';
import { UsersTable, type UsersTableUser, type UsersTableLocation } from '@/components/users-table';
import { AddUserDialog } from '@/components/add-user-dialog';

export default function UsersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteUserId, setDeleteUserId] = useState<number | null>(null);

  const { data: currentUserResponse } = useQuery<{ success: boolean; data: UsersTableUser }>({
    queryKey: ['/api/user'],
  });
  const currentUser = currentUserResponse?.data;
  const organizationId = currentUser?.organizationId;

  const { data: orgUsersResponse, isLoading: orgUsersLoading } = useQuery<{ success: boolean; data: UsersTableUser[] }>({
    queryKey: ['/api/org-admin/users', organizationId],
    queryFn: async () => {
      const response = await fetch(`/api/org-admin/users?organizationId=${organizationId}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch users');
      return response.json();
    },
    enabled: !!organizationId,
  });

  const { data: locationsResponse } = useQuery<{ success: boolean; data: UsersTableLocation[] }>({
    queryKey: ['/api/locations'],
  });

  const orgUsers = orgUsersResponse?.data || [];
  const locations = locationsResponse?.data || [];
  const orgLocations = locations.filter(l => l.organizationId === organizationId);

  const removeUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      await apiRequest(`/api/org-admin/users/${userId}/remove`, 'DELETE');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/org-admin/users'] });
      setDeleteUserId(null);
      toast({ title: 'User removed', description: 'User has been removed from the organization.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const getUserToDelete = deleteUserId ? orgUsers.find(u => u.id === deleteUserId) : null;

  return (
    <Layout>
      <ErrorBoundary level="section">
        <div className="container py-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-4xl font-bold">Users</h1>
            <Button onClick={() => setAddDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add User
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Organization Users</CardTitle>
            </CardHeader>
            <CardContent>
              {orgUsersLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : orgUsers.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No users in this organization yet.</p>
              ) : (
                <UsersTable
                  users={orgUsers}
                  currentUser={currentUser}
                  orgLocations={orgLocations}
                  onDeleteUser={setDeleteUserId}
                />
              )}
            </CardContent>
          </Card>

          <AddUserDialog
            open={addDialogOpen}
            onClose={() => setAddDialogOpen(false)}
            orgLocations={orgLocations}
          />

          <Dialog open={!!deleteUserId} onOpenChange={(open) => !open && setDeleteUserId(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Remove User</DialogTitle>
                <DialogDescription>
                  Are you sure you want to remove {getUserToDelete?.name || getUserToDelete?.email} from the organization? They will lose access to all organization data.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteUserId(null)}>Cancel</Button>
                <Button
                  variant="destructive"
                  onClick={() => deleteUserId && removeUserMutation.mutate(deleteUserId)}
                >
                  {removeUserMutation.isPending ? 'Removing...' : 'Remove'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </ErrorBoundary>
    </Layout>
  );
}
