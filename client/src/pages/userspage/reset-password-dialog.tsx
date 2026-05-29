import type { UseFormReturn } from 'react-hook-form';
import type { UseMutationResult } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
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
import { Input } from '@/components/ui/input';
import type { UsersTableUser } from '@/components/users-table';

type ResetPasswordDialogFormValues = { newPassword: string };

interface Props {
  resetPasswordUserId: number | null;
  setResetPasswordUserId: (id: number | null) => void;
  getUserToReset: UsersTableUser | undefined | null;
  resetPasswordForm: UseFormReturn<ResetPasswordDialogFormValues>;
  resetPasswordMutation: UseMutationResult<
    void,
    Error,
    { userId: number; newPassword: string }
  >;
}

export function ResetPasswordDialog({
  resetPasswordUserId,
  setResetPasswordUserId,
  getUserToReset,
  resetPasswordForm,
  resetPasswordMutation,
}: Props) {
  return (
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
  );
}
