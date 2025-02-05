import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Layout } from "@/components/layout";
import { Loader2 } from "lucide-react";
import type { Bowler, Payment, League } from "@shared/schema";

export default function HomePage() {
  const { data: bowlers, isLoading: loadingBowlers } = useQuery<Bowler[]>({
    queryKey: ["/api/bowlers"],
  });

  const { data: payments, isLoading: loadingPayments } = useQuery<Payment[]>({
    queryKey: ["/api/payments"],
  });

  const { data: leagues, isLoading: loadingLeagues } = useQuery<League[]>({
    queryKey: ["/api/leagues"],
  });

  if (loadingBowlers || loadingPayments || loadingLeagues) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  const activeBowlers = bowlers?.filter(b => b.active).length || 0;
  const totalRevenue = payments?.reduce((sum, p) => sum + p.amount, 0) || 0;
  const pendingPayments = payments?.filter(p => p.status === "pending").length || 0;
  const totalLeagues = leagues?.length || 0;

  return (
    <Layout>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Leagues</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalLeagues}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Bowlers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeBowlers}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${(totalRevenue / 100).toFixed(2)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Payments</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingPayments}</div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}