import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PageLoadingState({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-[50vh]">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      {message && <p className="mt-4 text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}

export function PageErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="p-4 rounded-md bg-destructive/10 text-destructive flex items-center gap-2">
      <AlertCircle className="h-5 w-5 shrink-0" />
      <p className="flex-1">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
