import { useState, FC } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ApiResponse } from "@shared/schema";

interface LinkRow {
  id: number;
  bowlerAId: number;
  bowlerBId: number;
  status: "pending" | "accepted";
  organizationId: number;
}

/**
 * Task #678 — admin direct-link panel on bowler-view-page.
 *
 * Lists the bowler's existing payment-partner rows and lets the admin
 * link this bowler to another bowler in the same org by id (status is
 * promoted directly to "accepted", bypassing the invite/accept dance).
 * The admin endpoint enforces same-org and rejects org-less bowlers.
 */
export const AdminBowlerLinkPanel: FC<{ bowlerId: number }> = ({ bowlerId }) => {
  const { toast } = useToast();
  const [partnerId, setPartnerId] = useState("");

  const { data } = useQuery<ApiResponse<{ links: LinkRow[] }>>({
    queryKey: ["/api/bowler-links/admin"],
    staleTime: 30_000,
  });
  const all = data?.data?.links ?? [];
  const mine = all.filter((l) => l.bowlerAId === bowlerId || l.bowlerBId === bowlerId);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/bowler-links/admin"] });
    queryClient.invalidateQueries({ queryKey: ["/api/bowler-links"] });
  };

  const link = useMutation({
    mutationFn: async (otherId: number) =>
      apiRequest("POST", "/api/bowler-links/admin", { bowlerAId: bowlerId, bowlerBId: otherId }),
    onSuccess: () => {
      setPartnerId("");
      invalidate();
      toast({ title: "Partner linked" });
    },
    onError: (err: Error) =>
      toast({ title: "Link failed", description: err.message, variant: "destructive" }),
  });

  const unlink = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/bowler-links/${id}`),
    onSuccess: () => invalidate(),
    onError: (err: Error) =>
      toast({ title: "Unlink failed", description: err.message, variant: "destructive" }),
  });

  return (
    <Card data-testid="card-admin-bowler-links" className="mt-4">
      <CardHeader>
        <CardTitle className="text-base">Payment partners (admin)</CardTitle>
        <CardDescription>Link this bowler to another bowler in the same organization.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {mine.length > 0 && (
          <div className="space-y-2">
            {mine.map((l) => {
              const otherId = l.bowlerAId === bowlerId ? l.bowlerBId : l.bowlerAId;
              return (
                <div
                  key={l.id}
                  data-testid={`row-admin-link-${l.id}`}
                  className="flex items-center justify-between rounded border p-2 text-sm"
                >
                  <span>Bowler #{otherId}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={l.status === "accepted" ? "secondary" : "outline"}>
                      {l.status}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid={`button-admin-unlink-${l.id}`}
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
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = parseInt(partnerId, 10);
            if (Number.isFinite(n) && n > 0) link.mutate(n);
          }}
        >
          <Input
            type="number"
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            placeholder="Partner bowler id"
            data-testid="input-admin-partner-id"
          />
          <Button
            type="submit"
            data-testid="button-admin-link"
            disabled={link.isPending || !partnerId.trim()}
          >
            Link
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};

export default AdminBowlerLinkPanel;
