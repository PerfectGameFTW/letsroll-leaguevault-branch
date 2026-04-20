import { FC, useState } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight, LogOut, Trash2 } from "lucide-react";
import { PageLoadingState } from "@/components/page-states";
import { Link } from "wouter";
import { BowlerLayout } from "@/components/bowler-layout";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, clearCsrfToken } from "@/lib/queryClient";
import { ProfileInfoCard } from "@/components/profile-info-card";
import { ChangePasswordCard } from "@/components/change-password-card";
import { SavedPaymentMethodsCard } from "@/components/saved-payment-methods-card";
import type { User, ApiResponse } from "@shared/schema";

const STALE_TIME = 1000 * 60 * 5;

export const ProfileSettingsPage: FC = () => {
  const { toast } = useToast();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const { data: userResponse, isLoading: isLoadingUser } = useQuery<ApiResponse<User>>({
    queryKey: ['/api/user'],
    staleTime: STALE_TIME,
  });
  const currentUser = userResponse?.data;
  const bowlerId = currentUser?.bowlerId;

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      await apiRequest('/api/auth/logout', 'POST', {});
      clearCsrfToken();
      window.location.href = '/login';
    } catch (error) {
      console.error('Logout failed:', error);
      toast({ title: "Logout failed", description: "Please try again.", variant: "destructive" });
    } finally {
      setIsLoggingOut(false);
    }
  };

  if (isLoadingUser) {
    return <PageLoadingState message="Loading profile..." />;
  }

  if (!currentUser) {
    return (
      <Card className="mx-auto max-w-md mt-8">
        <CardHeader>
          <CardTitle>Authentication Required</CardTitle>
          <CardDescription>Please log in to view your profile settings</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/login">
            <Button className="w-full">Log In</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const isSystemAdmin = currentUser.role === 'system_admin';

  return (
    <BowlerLayout bowlerName={currentUser.name} leagueName="">
      <ErrorBoundary level="section">
        {isSystemAdmin && (
          <div className="mb-6">
            <Link href="/">
              <Button variant="outline" className="flex items-center gap-2">
                <ArrowRight className="h-4 w-4 rotate-180" />
                Back to Dashboard
              </Button>
            </Link>
          </div>
        )}

        <div className="space-y-6 max-w-2xl">
          <ProfileInfoCard currentUser={currentUser} />
          <ChangePasswordCard />
          {bowlerId && <SavedPaymentMethodsCard bowlerId={bowlerId} />}

          <Separator />

          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Sign Out</CardTitle>
              <CardDescription className="mt-1.5">Log out of your account on this device</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="destructive"
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="flex items-center gap-2"
              >
                {isLoggingOut ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />Signing out...</>
                ) : (
                  <><LogOut className="h-4 w-4" />Sign Out</>
                )}
              </Button>
            </CardContent>
          </Card>

          <Separator />

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-destructive" />
                Delete Account
              </CardTitle>
              <CardDescription className="mt-1.5">Permanently delete your account and all associated data</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/delete-account">
                <Button variant="outline" className="text-destructive border-destructive hover:bg-destructive/10 flex items-center gap-2">
                  <Trash2 className="h-4 w-4" />
                  Request Account Deletion
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </ErrorBoundary>
    </BowlerLayout>
  );
};

export default ProfileSettingsPage;
