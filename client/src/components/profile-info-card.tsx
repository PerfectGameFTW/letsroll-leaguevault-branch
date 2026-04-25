import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Save, Pencil, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  LANGUAGE_AUTO,
  LANGUAGE_OPTIONS,
  languageLabelFor,
  languageSelectionToWire,
  normalizeStoredLanguage,
} from "@/lib/preferred-language";
import type { User } from "@shared/schema";

// Server augments the /api/user response with a derived
// `paymentSyncStatus` ('pending_retry' if the linked bowler row has
// `payment_sync_pending_at` set, otherwise null) so the retry button
// can be hydrated on initial page load — see auth.ts /user handler
// (#363). Optional because older API consumers (or unit-test fixtures
// that pass a bare User row) won't include it; treat missing as null.
export type CurrentUserWithSyncStatus = User & {
  paymentSyncStatus?: 'pending_retry' | null;
};

const profileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email"),
  phone: z.string().nullable().optional(),
  // Captured as a string by the form (Select can't bind null). The
  // mutation below maps the LANGUAGE_AUTO sentinel back to null
  // before sending the payload.
  preferredLanguage: z.string(),
});

type ProfileFormData = z.infer<typeof profileSchema>;

type PaymentSyncStatus = "synced" | "skipped" | "pending_retry" | "not_applicable";

export function ProfileInfoCard({ currentUser }: { currentUser: CurrentUserWithSyncStatus }) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  // Tracks the most recent payment-sync outcome so the "Retry now"
  // button (task #323) shows up immediately after a profile edit
  // returns `pending_retry`, and disappears once a manual retry
  // succeeds. Hydrated from the server-provided
  // `currentUser.paymentSyncStatus` (#363) so the button persists
  // across page reloads while the underlying flag is set, and the
  // useEffect below keeps it in sync after /api/user is invalidated
  // (e.g. by a profile save or a successful retry).
  const [lastSyncStatus, setLastSyncStatus] = useState<PaymentSyncStatus | null>(
    () => currentUser.paymentSyncStatus ?? null,
  );

  // The mutations below invalidate `['/api/user']`, which produces a
  // fresh `currentUser` prop with an updated `paymentSyncStatus`. We
  // mirror that into local state so a successful retry clears the
  // button without needing a manual setLastSyncStatus(null), and so a
  // background sweep that re-flags the bowler (after the user already
  // saw `synced` in this session) re-shows the action on next refetch.
  // Guarded so we only overwrite local state when the server-derived
  // value differs from what we already have — avoids clobbering a
  // freshly-set transient status (e.g. 'synced' from the retry mutation
  // before the next /api/user refetch lands) on every parent re-render.
  useEffect(() => {
    const next = currentUser.paymentSyncStatus ?? null;
    setLastSyncStatus((prev) => (prev === next ? prev : next));
  }, [currentUser.paymentSyncStatus]);

  const form = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: "", email: "", phone: "", preferredLanguage: LANGUAGE_AUTO },
    values: {
      name: currentUser.name,
      email: currentUser.email,
      phone: currentUser.phone || "",
      // null/empty in the DB = "auto / follow default", which the
      // Select represents with a non-empty sentinel. Any legacy /
      // unknown code is also coerced to AUTO so a save isn't blocked
      // on a value the new validator no longer accepts.
      preferredLanguage: normalizeStoredLanguage(currentUser.preferredLanguage),
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: ProfileFormData) => {
      const trimmedPhone = (data.phone ?? "").trim();
      const payload = {
        name: data.name,
        email: data.email,
        phone: trimmedPhone === "" ? null : trimmedPhone,
        // Map the Select sentinel back to null so the backend stores
        // "no preference" rather than a bogus locale code.
        preferredLanguage: languageSelectionToWire(data.preferredLanguage),
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
  // task #323. Since #363 added server-derived `paymentSyncStatus`
  // to /api/user, we MUST invalidate that query on success so the
  // canonical pending flag (bowler.payment_sync_pending_at) propagates
  // to every consumer of /api/user across the app — including a fresh
  // page load, another tab, or any other component reading the
  // currentUser query. The local `setLastSyncStatus(status)` below
  // still gives an instant UX response; the invalidation triggers a
  // refetch that hydrates the rest of the app and re-runs the
  // mirroring useEffect above on the next render.
  const retryMutation = useMutation({
    mutationFn: async () =>
      apiRequest<{ paymentSyncStatus?: PaymentSyncStatus }>(
        "/api/account/profile/retry-payment-sync",
        "POST",
      ),
    onSuccess: (response) => {
      const status = response?.data?.paymentSyncStatus ?? null;
      setLastSyncStatus(status);
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
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
            <div>
              <p className="text-sm font-medium text-muted-foreground">Preferred language</p>
              <p className="text-sm mt-1" data-testid="text-preferred-language">
                {languageLabelFor(currentUser.preferredLanguage)}
              </p>
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
              <FormField
                control={form.control}
                name="preferredLanguage"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Preferred language</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-preferred-language">
                          <SelectValue placeholder="Auto (follow my browser)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={LANGUAGE_AUTO} data-testid="option-language-auto">
                          Auto (follow my browser)
                        </SelectItem>
                        {LANGUAGE_OPTIONS.map(opt => (
                          <SelectItem
                            key={opt.value}
                            value={opt.value}
                            data-testid={`option-language-${opt.value}`}
                          >
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Used for security emails like password-change notifications.
                    </p>
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
