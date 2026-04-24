import { useState } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  DEFAULT_THROTTLE_FALLBACK_SECONDS,
  formatCountdown,
  useThrottleCountdown,
} from "@/hooks/use-throttle-countdown";

type ApiErrorLike = Error & {
  status?: number;
  code?: string;
  retryAfterSeconds?: number | null;
};

function isRateLimitError(err: unknown): err is ApiErrorLike {
  if (!(err instanceof Error)) return false;
  const e = err as ApiErrorLike;
  return e.code === "RATE_LIMITED" || e.status === 429 || e.message.startsWith("429:");
}

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
  confirmPassword: z.string().min(1, "Please confirm your new password"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type PasswordFormData = z.infer<typeof passwordSchema>;

export function ChangePasswordCard() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  // Throttle banner state lives in `useThrottleCountdown` (task #411
  // factored this out so login + forgot-password can share it).
  const { isThrottled, remainingSeconds, throttle, clear: clearThrottle } =
    useThrottleCountdown();

  const form = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const mutation = useMutation({
    mutationFn: async (data: PasswordFormData) => {
      return apiRequest("/api/account/change-password", "POST", {
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });
    },
    onSuccess: () => {
      form.reset();
      setShowForm(false);
      clearThrottle();
      toast({ title: "Password Changed", description: "Your password has been updated successfully." });
    },
    onError: (error: Error) => {
      if (isRateLimitError(error)) {
        const retry = (error as ApiErrorLike).retryAfterSeconds;
        const waitSeconds =
          retry != null && retry > 0 ? retry : DEFAULT_THROTTLE_FALLBACK_SECONDS;
        throttle(waitSeconds);
        return;
      }
      toast({
        title: "Password Change Failed",
        description: error.message || "Failed to change password",
        variant: "destructive",
      });
    },
  });

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle>Change Password</CardTitle>
        <CardDescription className="mt-1.5">Update your account password</CardDescription>
      </CardHeader>
      <CardContent>
        {!showForm ? (
          <Button variant="outline" onClick={() => setShowForm(true)} className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            Change Password
          </Button>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))} className="space-y-5">
              {isThrottled && (
                <Alert variant="destructive" data-testid="alert-change-password-throttled">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Too many attempts</AlertTitle>
                  <AlertDescription className="space-y-2">
                    <p>
                      You've made too many password change attempts. Please wait about{" "}
                      <span data-testid="text-change-password-retry-in">
                        {formatCountdown(remainingSeconds)}
                      </span>{" "}
                      and try again.
                    </p>
                    <p>
                      Can't remember your current password?{" "}
                      <Link
                        href="/forgot-password"
                        className="font-medium underline underline-offset-2"
                        data-testid="link-change-password-forgot"
                      >
                        Reset it instead
                      </Link>
                      .
                    </p>
                  </AlertDescription>
                </Alert>
              )}
              <FormField
                control={form.control}
                name="currentPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Current Password</FormLabel>
                    <FormControl><Input type="password" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New Password</FormLabel>
                    <FormControl><Input type="password" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm New Password</FormLabel>
                    <FormControl><Input type="password" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex gap-2 pt-1">
                <Button
                  type="submit"
                  disabled={mutation.isPending || isThrottled}
                  data-testid="button-change-password-submit"
                >
                  {mutation.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Updating...</>
                  ) : isThrottled ? (
                    `Try again in ${formatCountdown(remainingSeconds)}`
                  ) : "Update Password"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { form.reset(); setShowForm(false); }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Form>
        )}
      </CardContent>
    </Card>
  );
}
