import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Users, CircleDollarSign, ShieldCheck } from "lucide-react";
import { Link } from "wouter";

export function LeagueActionCards({
  leagueId,
  canManageSecretaries,
}: {
  leagueId: number;
  canManageSecretaries: boolean;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Link href={`/leagues/${leagueId}/teams`} className="block">
        <Card className="hover:bg-accent transition-colors">
          <CardHeader>
            <div className="flex justify-center mb-2">
              <Users className="size-6" />
            </div>
            <CardTitle>Roster Management</CardTitle>
            <CardDescription>
              Manage bowlers and teams in your league
            </CardDescription>
          </CardHeader>
          <CardContent>
          </CardContent>
        </Card>
      </Link>

      <Link href={`/leagues/${leagueId}/weekly-payments`} className="block">
        <Card className="hover:bg-accent transition-colors">
          <CardHeader>
            <div className="flex justify-center mb-2">
              <CircleDollarSign className="size-6" />
            </div>
            <CardTitle>Weekly Payments</CardTitle>
            <CardDescription>
              Log and track weekly cash/check payments
            </CardDescription>
          </CardHeader>
          <CardContent>
          </CardContent>
        </Card>
      </Link>

      {canManageSecretaries && (
        <Link
          href={`/leagues/${leagueId}/secretaries`}
          className="block"
          data-testid="link-league-secretaries"
        >
          <Card className="hover:bg-accent transition-colors">
            <CardHeader>
              <div className="flex justify-center mb-2">
                <ShieldCheck className="size-6" />
              </div>
              <CardTitle>Secretaries</CardTitle>
              <CardDescription>
                Grant per-league admin access to a non-admin user
              </CardDescription>
            </CardHeader>
            <CardContent>
            </CardContent>
          </Card>
        </Link>
      )}
    </div>
  );
}
