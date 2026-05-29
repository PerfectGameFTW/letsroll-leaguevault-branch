import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { DeletionRequest } from '@shared/schema';
import type { ReviewMode } from './utils';

interface DeletionReviewDialogProps {
  activeRequest: DeletionRequest | null;
  reviewMode: ReviewMode;
  adminNote: string;
  setAdminNote: (value: string) => void;
  executeConfirmText: string;
  setExecuteConfirmText: (value: string) => void;
  isExecutePending: boolean;
  isReviewPending: boolean;
  onClose: () => void;
  onExecute: () => void;
  onReview: () => void;
}

export function DeletionReviewDialog({
  activeRequest,
  reviewMode,
  adminNote,
  setAdminNote,
  executeConfirmText,
  setExecuteConfirmText,
  isExecutePending,
  isReviewPending,
  onClose,
  onExecute,
  onReview,
}: DeletionReviewDialogProps) {
  return (
    <Dialog
      open={!!activeRequest}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
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
                {activeRequest?.email}. This does not automatically delete user data;
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
                aria-label="Type DELETE to confirm"
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
            onClick={onClose}
          >
            Cancel
          </Button>
          {reviewMode === 'execute' ? (
            <Button
              variant="destructive"
              disabled={isExecutePending || executeConfirmText !== 'DELETE'}
              onClick={onExecute}
            >
              {isExecutePending ? 'Deleting...' : 'Delete account data'}
            </Button>
          ) : (
            <Button
              variant={reviewMode === 'rejected' ? 'destructive' : 'default'}
              disabled={isReviewPending}
              onClick={onReview}
            >
              {isReviewPending ? 'Saving...' : reviewMode === 'completed' ? 'Mark completed' : 'Reject'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
