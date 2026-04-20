import { FC, useState } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Save, Lock, ArrowRight, LogOut, Pencil, CreditCard, Trash2 } from "lucide-react";
import { PageLoadingState } from "@/components/page-states";
import { Link, useLocation } from "wouter";
import { BowlerLayout } from "@/components/bowler-layout";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, clearCsrfToken, csrfFetch } from "@/lib/queryClient";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { User, SavedCard, ApiResponse } from "@shared/schema";

const profileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email"),
  phone: z.string().nullable().optional(),
});

type ProfileFormData = z.infer<typeof profileSchema>;

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
  confirmPassword: z.string().min(1, "Please confirm your new password"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type PasswordFormData = z.infer<typeof passwordSchema>;

const STALE_TIME = 1000 * 60 * 5;

export const ProfileSettingsPage: FC = () => {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [cardToDelete, setCardToDelete] = useState<SavedCard | null>(null);
  const [isDeletingCard, setIsDeletingCard] = useState(false);

  const { data: userResponse, isLoading: isLoadingUser } = useQuery<ApiResponse<User>>({
    queryKey: ['/api/user'],
    staleTime: STALE_TIME,
  });
  const currentUser = userResponse?.data;
  const bowlerId = currentUser?.bowlerId;

  const { data: savedCardsResponse, isLoading: isLoadingCards } = useQuery<{ success: boolean; data: SavedCard[] }>({
    queryKey: [`/api/payments-provider/cards/${bowlerId}`],
    queryFn: async () => {
      const res = await csrfFetch(`/api/payments-provider/cards/${bowlerId}`);
      if (!res.ok) throw new Error('Failed to load saved cards');
      return res.json();
    },
    enabled: !!bowlerId,
    retry: false,
  });
  const savedCards = savedCardsResponse?.data || [];

  const handleDeleteCard = async (card: SavedCard) => {
    if (!bowlerId) return;
    setIsDeletingCard(true);
    try {
      const res = await csrfFetch(`/api/payments-provider/cards/${bowlerId}/${card.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Failed to remove card');
      }
      toast({ title: "Card Removed", description: `Your ${card.brand} card ending in ${card.last4} has been removed.` });
      queryClient.invalidateQueries({ queryKey: [`/api/payments-provider/cards/${bowlerId}`] });
    } catch (err: any) {
      toast({ title: "Error", description: err?.message || 'Failed to remove card', variant: "destructive" });
    } finally {
      setIsDeletingCard(false);
      setCardToDelete(null);
    }
  };

  const profileForm = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
    },
    values: currentUser ? {
      name: currentUser.name,
      email: currentUser.email,
      phone: currentUser.phone || "",
    } : undefined,
  });

  const passwordForm = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const profileMutation = useMutation({
    mutationFn: async (data: ProfileFormData) => {
      return apiRequest(`/api/account/profile/${currentUser!.id}`, 'PATCH', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });
      setIsEditingProfile(false);
      toast({
        title: "Profile Updated",
        description: "Your profile has been saved successfully.",
      });
    },
    onError: (error: any) => {
      const message = error?.error?.message || error?.message || "Failed to update profile";
      toast({
        title: "Update Failed",
        description: message,
        variant: "destructive",
      });
    },
  });

  const passwordMutation = useMutation({
    mutationFn: async (data: PasswordFormData) => {
      return apiRequest('/api/account/change-password', 'POST', {
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });
    },
    onSuccess: () => {
      passwordForm.reset();
      setShowPasswordForm(false);
      toast({
        title: "Password Changed",
        description: "Your password has been updated successfully.",
      });
    },
    onError: (error: any) => {
      const message = error?.error?.message || error?.message || "Failed to change password";
      toast({
        title: "Password Change Failed",
        description: message,
        variant: "destructive",
      });
    },
  });

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      await apiRequest('/api/auth/logout', 'POST', {});
      clearCsrfToken();
      window.location.href = '/login';
    } catch (error) {
      console.error('Logout failed:', error);
      toast({
        title: "Logout failed",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoggingOut(false);
    }
  };

  const isSystemAdmin = currentUser?.role === 'system_admin';

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
        <Card>
          <CardHeader>
            <CardTitle>Profile Settings</CardTitle>
            <CardDescription>Your personal information</CardDescription>
          </CardHeader>
          <CardContent>
            {!isEditingProfile ? (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Name</p>
                  <p className="text-sm mt-1">{currentUser.name}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Email</p>
                  <p className="text-sm mt-1">{currentUser.email}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Phone</p>
                  <p className="text-sm mt-1">{currentUser.phone || "Not provided"}</p>
                </div>
                <Button variant="outline" onClick={() => setIsEditingProfile(true)} className="flex items-center gap-2">
                  <Pencil className="h-4 w-4" />
                  Edit Profile
                </Button>
              </div>
            ) : (
              <Form {...profileForm}>
                <form onSubmit={profileForm.handleSubmit((data) => profileMutation.mutate(data))} className="space-y-4">
                  <FormField
                    control={profileForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={profileForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={profileForm.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone</FormLabel>
                        <FormControl>
                          <Input
                            type="tel"
                            placeholder="(555) 555-5555"
                            {...field}
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex gap-2 pt-1">
                    <Button type="submit" disabled={profileMutation.isPending}>
                      {profileMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="mr-2 h-4 w-4" />
                          Save Changes
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        profileForm.reset();
                        setIsEditingProfile(false);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle>Change Password</CardTitle>
            <CardDescription className="mt-1.5">Update your account password</CardDescription>
          </CardHeader>
          <CardContent>
            {!showPasswordForm ? (
              <Button variant="outline" onClick={() => setShowPasswordForm(true)} className="flex items-center gap-2">
                <Lock className="h-4 w-4" />
                Change Password
              </Button>
            ) : (
              <Form {...passwordForm}>
                <form onSubmit={passwordForm.handleSubmit((data) => passwordMutation.mutate(data))} className="space-y-5">
                  <FormField
                    control={passwordForm.control}
                    name="currentPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Current Password</FormLabel>
                        <FormControl>
                          <Input type="password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={passwordForm.control}
                    name="newPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New Password</FormLabel>
                        <FormControl>
                          <Input type="password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={passwordForm.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Confirm New Password</FormLabel>
                        <FormControl>
                          <Input type="password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex gap-2 pt-1">
                    <Button type="submit" disabled={passwordMutation.isPending}>
                      {passwordMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Updating...
                        </>
                      ) : (
                        "Update Password"
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        passwordForm.reset();
                        setShowPasswordForm(false);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>
        {bowlerId && (
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Saved Payment Methods
              </CardTitle>
              <CardDescription className="mt-1.5">Manage your saved credit cards</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingCards ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading saved cards...
                </div>
              ) : savedCards.length === 0 ? (
                <p className="text-sm text-muted-foreground">No saved cards on file. Cards saved during payment will appear here.</p>
              ) : (
                <div className="space-y-3">
                  {savedCards.map((card) => (
                    <div key={card.id} className="flex items-center justify-between rounded-lg border p-3">
                      <div className="flex items-center gap-3">
                        <CreditCard className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{card.brand} ending in {card.last4}</p>
                          <p className="text-xs text-muted-foreground">Expires {String(card.expMonth).padStart(2, '0')}/{card.expYear}</p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setCardToDelete(card)}
                        disabled={isDeletingCard}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <AlertDialog open={!!cardToDelete} onOpenChange={(open) => { if (!open && !isDeletingCard) setCardToDelete(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove saved card?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove your {cardToDelete?.brand} card ending in {cardToDelete?.last4} from your account. You can always add a new card later during payment.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeletingCard}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={isDeletingCard}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  if (cardToDelete) handleDeleteCard(cardToDelete);
                }}
              >
                {isDeletingCard ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Removing...</>
                ) : (
                  'Remove Card'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

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
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing out...
                </>
              ) : (
                <>
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </>
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
