import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { apiRequest } from '@/lib/queryClient';
import { Layout } from '@/components/layout';
import { ErrorBoundary } from '@/components/error-boundary';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Plus } from 'lucide-react';
import { UsersTable, type UsersTableUser, type UsersTableLocation } from '@/components/users-table';
import { AddUserDialog } from '@/components/add-user-dialog';
import { passwordSchema } from '@shared/password-validation';

// Reuses the SAME `passwordSchema` the server enforces, so client-side
// errors line up exactly with what the backend would reject. The form
// is field-level only (no confirm) — this is an admin assigning a
// temporary password, not a user picking one for themselves.
const resetPasswordFormSchema = z.object({
  newPassword: passwordSchema,
});
type ResetPasswordFormValues = z.infer<typeof resetPasswordFormSchema>;

export default function UsersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteUserId, setDeleteUserId] = useState<number | null>(null);
  const [resetPasswordUserId, setResetPasswordUserId] = useState<number | null>(null);

  const resetPasswordForm = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordFormSchema),
    defaultValues: { newPassword: '' },
  });

  // Clear the password field whenever the dialog closes so the
  // previous value doesn't linger in memory between resets.
  useEffect(() => {
    if (resetPasswordUserId === null) {
      resetPasswordForm.reset({ newPassword: '' });
    }
  }, [resetPasswordUserId, resetPasswordForm]);

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

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      await apiRequest(`/api/org-admin/users/${userId}`, 'DELETE');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/org-admin/users'] });
      setDeleteUserId(null);
      toast({
        title: 'User deleted',
        description: 'The user account has been permanently removed.',
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ userId, newPassword }: { userId: number; newPassword: string }) => {
      // The router is mounted at /api/org-admin (see
      // server/routes/index.ts), so the full path is
      // /api/org-admin/users/:id/reset-password. The endpoint
      // takes care of the security email, session invalidation,
      // and pending email-change cleanup itself — there's
      // nothing extra for the client to coordinate.
      await apiRequest(`/api/org-admin/users/${userId}/reset-password`, 'POST', { newPassword });
    },
    onSuccess: () => {
      setResetPasswordUserId(null);
      toast({
        title: 'Password reset',
        description: "The user's password has been reset and they have been emailed a security notice.",
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const getUserToDelete = deleteUserId ? orgUsers.find(u => u.id === deleteUserId) : null;
  const getUserToReset = resetPasswordUserId ? orgUsers.find(u => u.id === resetPasswordUserId) : null;

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
                  onResetPassword={setResetPasswordUserId}
                />
              )}
            </CardContent>
          </Card>

          <AddUserDialog
            open={addDialogOpen}
            onClose={() => setAddDialogOpen(false)}
            orgLocations={orgLocations}
          />

          <Dialog
            open={!!resetPasswordUserId}
            onOpenChange={(open) => !open && setResetPasswordUserId(null)}
          >
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Reset password</DialogTitle>
                <DialogDescription>
                  Set a new password for{' '}
                  <span className="font-medium">
                    {getUserToReset?.name || getUserToReset?.email}
                  </span>
                  . They will be emailed a security notice and any other active sessions they have will be signed out.
                </DialogDescription>
              </DialogHeader>
              <Form {...resetPasswordForm}>
                <form
                  onSubmit={resetPasswordForm.handleSubmit((values) => {
                    if (resetPasswordUserId === null) return;
                    resetPasswordMutation.mutate({
                      userId: resetPasswordUserId,
                      newPassword: values.newPassword,
                    });
                  })}
                  className="space-y-4"
                >
                  <FormField
                    control={resetPasswordForm.control}
                    name="newPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New password</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            autoComplete="new-password"
                            placeholder="At least 8 characters"
                            data-testid="input-reset-password"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setResetPasswordUserId(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={resetPasswordMutation.isPending}
                      data-testid="button-confirm-reset-password"
                    >
                      {resetPasswordMutation.isPending ? 'Resetting…' : 'Reset password'}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>

          <Dialog open={!!deleteUserId} onOpenChange={(open) => !open && setDeleteUserId(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete user permanently?</DialogTitle>
                <DialogDescription>
                  This will permanently delete{' '}
                  <span className="font-medium">
                    {getUserToDelete?.name || getUserToDelete?.email}
                  </span>
                  's account. They will lose access immediately and their login will stop working. This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteUserId(null)}>Cancel</Button>
                <Button
                  variant="destructive"
                  onClick={() => deleteUserId && deleteUserMutation.mutate(deleteUserId)}
                  disabled={deleteUserMutation.isPending}
                  data-testid="button-confirm-delete-user"
                >
                  {deleteUserMutation.isPending ? 'Deleting…' : 'Delete user'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </ErrorBoundary>
    </Layout>
  );
}
