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
import type { UsersTableUser } from '@/components/users-table';

interface Props {
  deleteUserId: number | null;
  setDeleteUserId: (id: number | null) => void;
  getUserToDelete: UsersTableUser | undefined | null;
  deleteUserMutation: UseMutationResult<void, Error, number>;
}

export function DeleteUserDialog({
  deleteUserId,
  setDeleteUserId,
  getUserToDelete,
  deleteUserMutation,
}: Props) {
  return (
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
  );
}
