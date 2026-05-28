import { ErrorBoundary } from "@/components/error-boundary";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ChangePasswordCard } from "@/components/change-password-card";
import { apiRequest, clearCsrfToken } from "@/lib/queryClient";
import { ShieldAlert, LogOut } from "lucide-react";

export default function ChangePasswordRequiredPage() {
  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', 'POST', {});
      clearCsrfToken();
    } catch {
      // Best-effort; the redirect below still happens so the user
      // can't be stranded on a screen they can't act on.
    } finally {
      window.location.href = '/login';
    }
  };

  return (
    <ErrorBoundary level="page">
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-4" data-testid="page-change-password-required">
          <Alert>
            <ShieldAlert className="size-4" />
            <AlertTitle>Choose a new password to continue</AlertTitle>
            <AlertDescription>
              An administrator recently reset your password. For your
              security, please pick a new one before you continue using
              your account. Use the password your administrator gave you
              as the current password.
            </AlertDescription>
          </Alert>

          <ChangePasswordCard forced />

          <div className="flex justify-center pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              data-testid="button-change-password-required-logout"
            >
              <LogOut className="size-4 mr-2" />
              Sign out instead
            </Button>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
