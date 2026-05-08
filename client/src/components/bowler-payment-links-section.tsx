import { useState, FC } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Users, Mail, X, Check } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ApiResponse } from "@shared/schema";

interface LinkRow {
  id: number;
  bowlerAId: number;
  bowlerBId: number;
  status: "pending" | "accepted";
  organizationId: number;
  createdByUserId: number | null;
  inviterBowlerId: number | null;
  partnerName: string;
}

interface LinksResponse {
  links: LinkRow[];
  hasAny: boolean;
}

/**
 * Task #678 — adult-bowler partner linking UI.
 *
 * Gate: section is hidden until `hasAny` is true. The first link must be
 * seeded by an org admin via the bowler-view admin panel; afterwards
 * the bowler can invite/accept/decline/unlink from this section.
 */
export const BowlerPaymentLinksSection: FC<{ currentBowlerId: number }> = ({ currentBowlerId }) => {
  const { toast } = useToast();
  const [inviteEmail, setInviteEmail] = useState("");

  const { data, isLoading } = useQuery<ApiResponse<LinksResponse>>({
    queryKey: ["/api/bowler-links"],
    staleTime: 30_000,
  });
  const payload = data?.data;
  const hasAny = !!payload?.hasAny;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/bowler-links"] });

  const inviteMutation = useMutation({
    mutationFn: async (email: string) =>
      apiRequest("POST", "/api/bowler-links/invite", { inviteeEmail: email }),
    onSuccess: () => {
      setInviteEmail("");
      invalidate();
      toast({ title: "Invite sent" });
    },
    onError: (err: Error) =>
      toast({ title: "Invite failed", description: err.message, variant: "destructive" }),
  });

  const respond = useMutation({
    mutationFn: async ({ id, action }: { id: number; action: "accept" | "decline" }) =>
      apiRequest("POST", `/api/bowler-links/${id}/${action}`),
    onSuccess: () => invalidate(),
    onError: (err: Error) =>
      toast({ title: "Action failed", description: err.message, variant: "destructive" }),
  });

  const unlink = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/bowler-links/${id}`),
    onSuccess: () => invalidate(),
    onError: (err: Error) =>
      toast({ title: "Unlink failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading || !hasAny) return null;

  const links = payload?.links ?? [];
  const accepted = links.filter((l) => l.status === "accepted");
  const pending = links.filter((l) => l.status === "pending");

  return (
    <Card data-testid="card-payment-partners" className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" /> Payment partners
        </CardTitle>
        <CardDescription>
          Linked bowlers can pay for each other from a saved card.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {accepted.length > 0 && (
          <div className="space-y-2">
            {accepted.map((l) => {
              return (
                <div
                  key={l.id}
                  data-testid={`row-partner-${l.id}`}
                  className="flex items-center justify-between rounded border p-2 text-sm"
                >
                  <span>{l.partnerName}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">Linked</Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid={`button-unlink-${l.id}`}
                      onClick={() => unlink.mutate(l.id)}
                      disabled={unlink.isPending}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {pending.length > 0 && (
          <div className="space-y-2">
            {pending.map((l) => {
              // Invitee = the side that did NOT initiate the invite.
              // inviterBowlerId is resolved server-side from createdByUserId.
              const isInvitee =
                l.inviterBowlerId !== null && l.inviterBowlerId !== currentBowlerId;
              return (
                <div
                  key={l.id}
                  data-testid={`row-pending-${l.id}`}
                  className="flex items-center justify-between rounded border p-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <Mail className="h-4 w-4" /> {l.partnerName}
                    <Badge variant="outline">Pending</Badge>
                  </span>
                  <div className="flex items-center gap-1">
                    {isInvitee && (
                      <>
                        <Button
                          size="sm"
                          variant="default"
                          data-testid={`button-accept-${l.id}`}
                          disabled={respond.isPending}
                          onClick={() => respond.mutate({ id: l.id, action: "accept" })}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          data-testid={`button-decline-${l.id}`}
                          disabled={respond.isPending}
                          onClick={() => respond.mutate({ id: l.id, action: "decline" })}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    {!isInvitee && (
                      <Button
                        size="sm"
                        variant="ghost"
                        data-testid={`button-cancel-${l.id}`}
                        disabled={unlink.isPending}
                        onClick={() => unlink.mutate(l.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const email = inviteEmail.trim().toLowerCase();
            if (email) inviteMutation.mutate(email);
          }}
        >
          <Input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="bowler@example.com"
            data-testid="input-invite-email"
          />
          <Button
            type="submit"
            data-testid="button-send-invite"
            disabled={inviteMutation.isPending || !inviteEmail.trim()}
          >
            Invite
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};

export default BowlerPaymentLinksSection;
