import { FC, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Save, Lock, ArrowRight, LogOut } from "lucide-react";
import { Link, useLocation } from "wouter";
import { BowlerLayout } from "@/components/bowler-layout";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import type { User } from "@shared/schema";

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

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
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const { data: userResponse, isLoading: isLoadingUser } = useQuery<ApiResponse<User>>({
    queryKey: ['/api/user'],
    staleTime: STALE_TIME,
  });
  const currentUser = userResponse?.data;

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
      return apiRequest(`/api/user-update/profile/${currentUser!.id}`, 'PATCH', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });
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
      return apiRequest('/api/user-update/change-password', 'POST', {
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
      await queryClient.cancelQueries();
      queryClient.clear();
      setLocation('/login');
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

  const isSystemAdmin = currentUser?.isAdmin && currentUser?.isOrganizationAdmin;

  if (isLoadingUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-sm text-muted-foreground">Loading profile...</p>
      </div>
    );
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
            <CardDescription>Update your personal information</CardDescription>
          </CardHeader>
          <CardContent>
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

                <Button type="submit" disabled={profileMutation.isPending} className="w-full sm:w-auto">
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
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Change Password</CardTitle>
            <CardDescription>Update your account password</CardDescription>
          </CardHeader>
          <CardContent>
            {!showPasswordForm ? (
              <Button variant="outline" onClick={() => setShowPasswordForm(true)} className="flex items-center gap-2">
                <Lock className="h-4 w-4" />
                Change Password
              </Button>
            ) : (
              <Form {...passwordForm}>
                <form onSubmit={passwordForm.handleSubmit((data) => passwordMutation.mutate(data))} className="space-y-4">
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

                  <div className="flex gap-2">
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
        <Separator />

        <Card>
          <CardHeader>
            <CardTitle>Sign Out</CardTitle>
            <CardDescription>Log out of your account on this device</CardDescription>
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
      </div>
    </BowlerLayout>
  );
};

export default ProfileSettingsPage;
