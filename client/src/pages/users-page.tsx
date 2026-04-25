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
import { parsePaymentSyncStatus, type PaymentSyncStatus } from '@shared/schema';

const resetPasswordFormSchema = z.object({
  newPassword: passwordSchema,
});
type ResetPasswordFormValues = z.infer<typeof resetPasswordFormSchema>;

const changeEmailFormSchema = z.object({
  email: z.string().email('Please enter a valid email'),
});
type ChangeEmailFormValues = z.infer<typeof changeEmailFormSchema>;

export default function UsersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteUserId, setDeleteUserId] = useState<number | null>(null);
  const [resetPasswordUserId, setResetPasswordUserId] = useState<number | null>(null);
  const [changeEmailUserId, setChangeEmailUserId] = useState<number | null>(null);

  const resetPasswordForm = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordFormSchema),
    defaultValues: { newPassword: '' },
  });

  const changeEmailForm = useForm<ChangeEmailFormValues>({
    resolver: zodResolver(changeEmailFormSchema),
    defaultValues: { email: '' },
  });

  useEffect(() => {
    if (resetPasswordUserId === null) {
      resetPasswordForm.reset({ newPassword: '' });
    }
  }, [resetPasswordUserId, resetPasswordForm]);

  useEffect(() => {
    if (changeEmailUserId === null) {
      changeEmailForm.reset({ email: '' });
    }
  }, [changeEmailUserId, changeEmailForm]);

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

  // Admin email change goes through the same PATCH /api/account/profile/:id
  // endpoint a user uses for their own profile (system_admin is allowed to
  // act on another user). The endpoint defers the actual email swap until
  // the target user clicks the confirmation link, but the response also
  // includes a `paymentSyncStatus` from any inline name/phone sync — and
  // for admin-initiated changes we want to surface the same retry notice
  // that ProfileInfoCard (#284) and the email-confirmation page (#322)
  // already show on `pending_retry` (#373).
  const changeEmailMutation = useMutation({
    mutationFn: async ({ userId, email }: { userId: number; email: string }) => {
      return apiRequest<{ paymentSyncStatus?: PaymentSyncStatus; emailChangeRequested?: boolean }>(
        `/api/account/profile/${userId}`,
        'PATCH',
        { email },
      );
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['/api/org-admin/users'] });
      setChangeEmailUserId(null);
      toast({
        title: 'Confirmation email sent',
        description:
          "We've emailed the user's new address. Their sign-in email will only change once they click the confirmation link.",
      });
      // Wording mirrors the toast in client/src/components/profile-info-card.tsx
      // and the alert in client/src/pages/confirm-email-change-page.tsx so an
      // admin who edits another user's email sees the same explanation.
      // The shared parser (task #374) collapses any unrecognized server
      // value to `not_applicable`, so an old client + future server
      // adding a fifth state silently no-ops here instead of toasting.
      const raw = response?.data?.paymentSyncStatus;
      const status: PaymentSyncStatus | null =
        raw == null ? null : parsePaymentSyncStatus(raw);
      if (status === 'pending_retry') {
        toast({
          title: 'Payment record will be retried',
          description:
            'Your payment profile is temporarily out of date and will be retried automatically. Charges or saved cards may behave oddly for the next few minutes.',
        });
      }
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const getUserToDelete = deleteUserId ? orgUsers.find(u => u.id === deleteUserId) : null;
  const getUserToReset = resetPasswordUserId ? orgUsers.find(u => u.id === resetPasswordUserId) : null;
  const getUserToChangeEmail = changeEmailUserId ? orgUsers.find(u => u.id === changeEmailUserId) : null;

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
                  onChangeEmail={setChangeEmailUserId}
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

          <Dialog
            open={!!changeEmailUserId}
            onOpenChange={(open) => !open && setChangeEmailUserId(null)}
          >
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Change email</DialogTitle>
                <DialogDescription>
                  Request a new sign-in email for{' '}
                  <span className="font-medium">
                    {getUserToChangeEmail?.name || getUserToChangeEmail?.email}
                  </span>
                  . The new address will receive a confirmation link, and their sign-in email will only change once they click it.
                </DialogDescription>
              </DialogHeader>
              <Form {...changeEmailForm}>
                <form
                  onSubmit={changeEmailForm.handleSubmit((values) => {
                    if (changeEmailUserId === null) return;
                    changeEmailMutation.mutate({
                      userId: changeEmailUserId,
                      email: values.email,
                    });
                  })}
                  className="space-y-4"
                >
                  <FormField
                    control={changeEmailForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New email</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            autoComplete="off"
                            placeholder="user@example.com"
                            data-testid="input-change-email"
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
                      onClick={() => setChangeEmailUserId(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={changeEmailMutation.isPending}
                      data-testid="button-confirm-change-email"
                    >
                      {changeEmailMutation.isPending ? 'Sending…' : 'Send confirmation'}
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
