import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Save, Pencil, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { User } from "@shared/schema";

const profileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email"),
  phone: z.string().nullable().optional(),
});

type ProfileFormData = z.infer<typeof profileSchema>;

type PaymentSyncStatus = "synced" | "skipped" | "pending_retry" | "not_applicable";

export function ProfileInfoCard({ currentUser }: { currentUser: User }) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  // Tracks the most recent payment-sync outcome so the "Retry now"
  // button (task #323) shows up immediately after a profile edit
  // returns `pending_retry`, and disappears once a manual retry
  // succeeds. Server doesn't currently surface a persistent
  // `payment_sync_pending_at` flag on /api/user, so this stays in
  // component state for the session — follow-up on the backend will
  // let us hydrate it on initial load too.
  const [lastSyncStatus, setLastSyncStatus] = useState<PaymentSyncStatus | null>(null);

  const form = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: "", email: "", phone: "" },
    values: {
      name: currentUser.name,
      email: currentUser.email,
      phone: currentUser.phone || "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: ProfileFormData) => {
      const trimmedPhone = (data.phone ?? "").trim();
      const payload = {
        name: data.name,
        email: data.email,
        phone: trimmedPhone === "" ? null : trimmedPhone,
      };
      return apiRequest<{ paymentSyncStatus?: PaymentSyncStatus }>(
        `/api/account/profile/${currentUser.id}`,
        "PATCH",
        payload,
      );
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      setIsEditing(false);
      toast({ title: "Profile Updated", description: "Your profile has been saved successfully." });
      const status = response?.data?.paymentSyncStatus ?? null;
      setLastSyncStatus(status);
      if (status === "pending_retry") {
        toast({
          title: "Payment record will be retried",
          description:
            "Your payment profile is temporarily out of date and will be retried automatically. Charges or saved cards may behave oddly for the next few minutes.",
        });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Update Failed", description: error.message || "Failed to update profile", variant: "destructive" });
    },
  });

  // Self-serve "Retry now" — calls the per-user endpoint added in
  // task #323. We deliberately don't invalidate /api/user here: the
  // user record itself didn't change, only the payment-sync status,
  // and the status flips lastSyncStatus directly so the UI updates
  // without a refetch.
  const retryMutation = useMutation({
    mutationFn: async () =>
      apiRequest<{ paymentSyncStatus?: PaymentSyncStatus }>(
        "/api/account/profile/retry-payment-sync",
        "POST",
      ),
    onSuccess: (response) => {
      const status = response?.data?.paymentSyncStatus ?? null;
      setLastSyncStatus(status);
      if (status === "synced") {
        toast({ title: "Payment record updated", description: "Your payment profile is back in sync." });
      } else if (status === "pending_retry") {
        toast({
          title: "Still out of date",
          description: "The retry didn't go through. We'll keep trying in the background — please try again in a few minutes.",
          variant: "destructive",
        });
      } else {
        // 'skipped' or 'not_applicable' — nothing to retry. Treat as
        // resolved so the button doesn't linger.
        toast({ title: "Nothing to retry", description: "No pending payment-sync work for your account." });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Retry failed",
        description: error.message || "Could not retry payment-sync right now.",
        variant: "destructive",
      });
    },
  });

  const showRetry = lastSyncStatus === "pending_retry";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile Settings</CardTitle>
        <CardDescription>Your personal information</CardDescription>
      </CardHeader>
      <CardContent>
        {!isEditing ? (
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
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setIsEditing(true)} className="flex items-center gap-2">
                <Pencil className="h-4 w-4" />
                Edit Profile
              </Button>
              {showRetry && (
                <Button
                  variant="outline"
                  onClick={() => retryMutation.mutate()}
                  disabled={retryMutation.isPending}
                  className="flex items-center gap-2"
                  data-testid="button-retry-payment-sync"
                >
                  {retryMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Retry payment sync
                </Button>
              )}
            </div>
            {showRetry && (
              <p className="text-xs text-muted-foreground">
                Your payment profile is temporarily out of date. We're retrying in the background — use this button to retry now.
              </p>
            )}
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl><Input type="email" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input type="tel" placeholder="(555) 555-5555" {...field} value={field.value || ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex gap-2 pt-1">
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>
                  ) : (
                    <><Save className="mr-2 h-4 w-4" />Save Changes</>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { form.reset(); setIsEditing(false); }}
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
