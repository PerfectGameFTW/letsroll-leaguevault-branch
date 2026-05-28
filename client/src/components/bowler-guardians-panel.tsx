/**
 * Task #679: Guardian management panel rendered on the bowler-view page
 * for org admins. Lists guardians of the bowler and lets admins invite
 * new ones (creating a user account if needed), reattach existing users,
 * toggle primary-contact / payer flags, and remove links.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Loader2, Trash2, Plus, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  GUARDIAN_RELATIONSHIPS,
  type ApiResponse,
  type BowlerGuardian,
  type GuardianRelationship,
} from "@shared/schema";

interface BowlerGuardiansPanelProps {
  bowlerId: number;
  bowlerIsMinor: boolean;
}

interface GuardianRow extends BowlerGuardian {
  guardian: { id: number; email: string; name: string } | null;
}

const inviteSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  relationship: z.enum(GUARDIAN_RELATIONSHIPS),
  isPrimaryContact: z.boolean(),
  isPayer: z.boolean(),
});
type InviteForm = z.infer<typeof inviteSchema>;

export function BowlerGuardiansPanel({ bowlerId, bowlerIsMinor }: BowlerGuardiansPanelProps) {
  const { toast } = useToast();
  const [inviteOpen, setInviteOpen] = useState(false);

  const { data, isLoading } = useQuery<ApiResponse<GuardianRow[]>>({
    queryKey: ["/api/bowlers", bowlerId, "guardians"],
    queryFn: async () => apiRequest<GuardianRow[]>(`/api/bowlers/${bowlerId}/guardians`, "GET"),
    staleTime: 1000 * 60,
  });
  const guardians = data?.data ?? [];

  const inviteForm = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: "",
      firstName: "",
      lastName: "",
      relationship: "parent",
      isPrimaryContact: true,
      isPayer: true,
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async (values: InviteForm) => {
      const res = await apiRequest(`/api/bowlers/${bowlerId}/guardians/invite`, "POST", values);
      if (!res.success) throw new Error(res.error?.message ?? "Failed to invite guardian");
      return res;
    },
    onSuccess: () => {
      toast({ title: "Guardian invited", description: "The guardian has been linked to this bowler." });
      queryClient.invalidateQueries({ queryKey: ["/api/bowlers", bowlerId, "guardians"] });
      setInviteOpen(false);
      inviteForm.reset();
    },
    onError: (err: Error) => {
      toast({ title: "Could not invite guardian", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Partial<Pick<BowlerGuardian, "isPrimaryContact" | "isPayer" | "relationship">> }) => {
      const res = await apiRequest(`/api/bowler-guardians/${id}`, "PATCH", patch);
      if (!res.success) throw new Error(res.error?.message ?? "Failed to update guardian");
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bowlers", bowlerId, "guardians"] });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest(`/api/bowler-guardians/${id}`, "DELETE");
      if (!res.success) throw new Error(res.error?.message ?? "Failed to remove guardian");
      return res;
    },
    onSuccess: () => {
      toast({ title: "Guardian removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/bowlers", bowlerId, "guardians"] });
    },
    onError: (err: Error) => {
      toast({ title: "Could not remove guardian", description: err.message, variant: "destructive" });
    },
  });

  const sortedGuardians = useMemo(
    () => guardians.toSorted((a, b) => Number(b.isPrimaryContact) - Number(a.isPrimaryContact)),
    [guardians],
  );

  return (
    <Card data-testid="card-bowler-guardians">
      <CardHeader className="flex-row items-center justify-between gap-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4" /> Guardians
        </CardTitle>
        <Button size="sm" onClick={() => setInviteOpen(true)} data-testid="button-invite-guardian">
          <Plus className="size-4 mr-1" /> Invite Guardian
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {bowlerIsMinor && guardians.length === 0 && !isLoading && (
          <p className="text-sm text-amber-700" data-testid="text-no-guardians-warning">
            This minor has no guardian on file. Add one before placing them on a youth-league team.
          </p>
        )}
        {isLoading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : sortedGuardians.length === 0 ? (
          <p className="text-sm text-muted-foreground">No guardians linked yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {sortedGuardians.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                data-testid={`row-guardian-${row.id}`}
              >
                <div className="flex flex-col">
                  <span className="font-medium">{row.guardian?.name ?? `User #${row.guardianUserId}`}</span>
                  <span className="text-xs text-muted-foreground">{row.guardian?.email ?? ""}</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge variant="secondary" className="capitalize">{row.relationship}</Badge>
                    {row.isPrimaryContact && <Badge>Primary contact</Badge>}
                    {row.isPayer && <Badge variant="outline">Payer</Badge>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1 text-xs">
                    <Switch
                      checked={row.isPrimaryContact}
                      onCheckedChange={(v) => updateMutation.mutate({ id: row.id, patch: { isPrimaryContact: v } })}
                      data-testid={`switch-primary-${row.id}`}
                    />
                    Primary
                  </label>
                  <label className="flex items-center gap-1 text-xs">
                    <Switch
                      checked={row.isPayer}
                      onCheckedChange={(v) => updateMutation.mutate({ id: row.id, patch: { isPayer: v } })}
                      data-testid={`switch-payer-${row.id}`}
                    />
                    Payer
                  </label>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeMutation.mutate(row.id)}
                    data-testid={`button-remove-guardian-${row.id}`}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Guardian</DialogTitle>
          </DialogHeader>
          <Form {...inviteForm}>
            <form
              onSubmit={inviteForm.handleSubmit((v) => inviteMutation.mutate(v))}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={inviteForm.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First name</FormLabel>
                      <FormControl><Input {...field} data-testid="input-guardian-first" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={inviteForm.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last name</FormLabel>
                      <FormControl><Input {...field} data-testid="input-guardian-last" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={inviteForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl><Input type="email" {...field} data-testid="input-guardian-email" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={inviteForm.control}
                name="relationship"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Relationship</FormLabel>
                    <Select value={field.value} onValueChange={(v) => field.onChange(v)}>
                      <FormControl>
                        <SelectTrigger data-testid="select-guardian-relationship"><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {GUARDIAN_RELATIONSHIPS.map((r) => (
                          <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex items-center justify-between rounded-lg border p-3">
                <FormLabel>Primary contact</FormLabel>
                <FormField
                  control={inviteForm.control}
                  name="isPrimaryContact"
                  render={({ field }) => (
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-invite-primary" />
                    </FormControl>
                  )}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <FormLabel>Payer</FormLabel>
                <FormField
                  control={inviteForm.control}
                  name="isPayer"
                  render={({ field }) => (
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-invite-payer" />
                    </FormControl>
                  )}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={inviteMutation.isPending} data-testid="button-submit-invite-guardian">
                  {inviteMutation.isPending && <Loader2 className="size-4 mr-1 animate-spin" />}
                  Send invite
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
