import { Link2, Unlink2, MapPin, Shield, Send, Trash2, KeyRound } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export interface UsersTableLinkedBowler {
  id: number;
  name: string;
  leagueName: string | null;
  teamName: string | null;
}

export interface UsersTableUser {
  id: number;
  email: string;
  name: string | null;
  role: string;
  organizationId: number | null;
  locationId: number | null;
  bowlerId: number | null;
  inviteToken: string | null;
  createdAt: string;
  linkedBowler: UsersTableLinkedBowler | null;
}

export interface UsersTableLocation {
  id: number;
  name: string;
  organizationId: number;
}

interface Props {
  users: UsersTableUser[];
  currentUser: UsersTableUser | undefined;
  orgLocations: UsersTableLocation[];
  onDeleteUser: (id: number) => void;
  onResetPassword: (id: number) => void;
}

const hasPendingInvite = (user: UsersTableUser) => !!user.inviteToken;

export function UsersTable({ users, currentUser, orgLocations, onDeleteUser, onResetPassword }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, makeOrgAdmin }: { userId: number; makeOrgAdmin: boolean }) => {
      return apiRequest(`/api/org-admin/users/${userId}/admin-status`, "PATCH", { makeOrgAdmin });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org-admin/users"] });
      toast({ title: "Role updated", description: "User role has been updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateLocationMutation = useMutation({
    mutationFn: async ({ userId, locationId }: { userId: number; locationId: number | null }) => {
      return apiRequest(`/api/org-admin/users/${userId}/location`, "PATCH", { locationId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org-admin/users"] });
      toast({ title: "Location updated", description: "User location assignment has been updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resendInviteMutation = useMutation({
    mutationFn: async (userId: number) => {
      return apiRequest(`/api/org-admin/users/${userId}/resend-invite`, "POST");
    },
    onSuccess: () => {
      toast({ title: "Invite sent", description: "A new invitation email has been sent." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Linked Bowler</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Location</TableHead>
          <TableHead className="w-[120px]"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => (
          <TableRow key={user.id}>
            <TableCell className="font-medium">{user.name || "—"}</TableCell>
            <TableCell>{user.email}</TableCell>
            <TableCell>
              {user.linkedBowler ? (
                <div className="flex items-center gap-1.5">
                  <Link2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                  <div className="text-sm">
                    <span className="font-medium">{user.linkedBowler.name}</span>
                    {(user.linkedBowler.teamName || user.linkedBowler.leagueName) && (
                      <span className="text-muted-foreground">
                        {" — "}
                        {[user.linkedBowler.teamName, user.linkedBowler.leagueName].filter(Boolean).join(", ")}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Unlink2 className="h-3.5 w-3.5 shrink-0" />
                  Unlinked
                </span>
              )}
            </TableCell>
            <TableCell>
              {hasPendingInvite(user) ? (
                <Badge variant="outline" className="text-amber-600 border-amber-300">Pending</Badge>
              ) : (
                <Badge variant="outline" className="text-green-600 border-green-300">Active</Badge>
              )}
            </TableCell>
            <TableCell>
              <Select
                value={user.role === "org_admin" || user.role === "system_admin" ? "admin" : "user"}
                onValueChange={(value) => {
                  if (user.id === currentUser?.id) {
                    toast({ title: "Error", description: "You cannot change your own role.", variant: "destructive" });
                    return;
                  }
                  updateRoleMutation.mutate({ userId: user.id, makeOrgAdmin: value === "admin" });
                }}
                disabled={user.id === currentUser?.id}
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">
                    <span className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" />
                      End User
                    </span>
                  </SelectItem>
                  <SelectItem value="admin">
                    <span className="flex items-center gap-1.5">
                      <Shield className="h-3.5 w-3.5" />
                      Admin
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </TableCell>
            <TableCell>
              {user.role === "org_admin" || user.role === "system_admin" ? (
                <Badge variant="secondary">All Locations</Badge>
              ) : (
                <Select
                  value={user.locationId ? String(user.locationId) : "none"}
                  onValueChange={(value) => {
                    updateLocationMutation.mutate({
                      userId: user.id,
                      locationId: value === "none" ? null : parseInt(value),
                    });
                  }}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No location</SelectItem>
                    {orgLocations.map((loc) => (
                      <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-1">
                {hasPendingInvite(user) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => resendInviteMutation.mutate(user.id)}
                    disabled={resendInviteMutation.isPending}
                    title="Resend invite email"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                )}
                {user.id !== currentUser?.id
                  && user.role !== "system_admin"
                  && (currentUser?.role !== "org_admin"
                    || user.organizationId === currentUser?.organizationId) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onResetPassword(user.id)}
                    title="Reset password"
                    aria-label={`Reset password for ${user.name || user.email}`}
                    data-testid={`button-reset-password-${user.id}`}
                  >
                    <KeyRound className="h-4 w-4" />
                  </Button>
                )}
                {user.id !== currentUser?.id && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDeleteUser(user.id)}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
