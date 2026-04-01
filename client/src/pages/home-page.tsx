import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Trophy, Users, Activity, ArrowUpRight, DollarSign } from "lucide-react";
import { Link } from "wouter";
import type { League, Payment, BowlerLeague, ApiResponse, Organization, User } from "@shared/schema";
import { getPaymentSummary } from "@/lib/financial-utils";
import { PastDueBowlersSection } from "@/components/past-due-bowlers-section";
import { formatCurrency } from "@/lib/utils";
import { ErrorBoundary } from "@/components/error-boundary";
import { DashboardSkeleton, PageErrorState } from "@/components/page-states";

function CollectionRateCircle({ rate }: { rate: number }) {
  return (
    <div className="relative w-9 h-9">
      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
        <path
          className="text-slate-100"
          strokeWidth="4"
          stroke="currentColor"
          fill="none"
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
        />
        <path
          className="text-indigo-500"
          strokeDasharray={`${rate}, 100`}
          strokeWidth="4"
          stroke="currentColor"
          fill="none"
          strokeLinecap="round"
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
        />
      </svg>
    </div>
  );
}

function LeagueHealthCard({ name, bowlerCount, collectionRate }: {
  name: string;
  bowlerCount: number;
  collectionRate: number;
}) {
  const status = collectionRate >= 98 ? "green" : collectionRate >= 90 ? "amber" : "red";

  return (
    <Link href="/leagues">
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow group cursor-pointer">
        <div className="flex justify-between items-start mb-3">
          <div className="font-semibold text-slate-800 text-sm leading-tight">
            {name}
          </div>
          <div
            className={`w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 ${
              status === "green"
                ? "bg-emerald-500"
                : status === "amber"
                ? "bg-amber-400"
                : "bg-red-500"
            }`}
          />
        </div>
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-sm text-slate-600">
            <span className="font-semibold text-slate-800">{bowlerCount}</span> bowlers
          </span>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-500">Collection</div>
          <div className="text-sm font-bold text-slate-900">{collectionRate}%</div>
        </div>
        <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden mt-1.5">
          <div
            className={`h-full rounded-full transition-all ${
              status === "green"
                ? "bg-emerald-500"
                : status === "amber"
                ? "bg-amber-400"
                : "bg-red-500"
            }`}
            style={{ width: `${collectionRate}%` }}
          />
        </div>
      </div>
    </Link>
  );
}

export default function HomePage() {
  const { data: leaguesResponse, isLoading: loadingLeagues, error: leaguesError, refetch: refetchLeagues } = useQuery<ApiResponse<League[]>>({
    queryKey: ["/api/leagues"],
    staleTime: 1000 * 30,
    retry: false,
  });

  const { data: paymentsResponse, isLoading: loadingPayments, error: paymentsError, refetch: refetchPayments } = useQuery<ApiResponse<Payment[]>>({
    queryKey: ["/api/payments"],
    staleTime: 1000 * 30,
    retry: false,
  });

  const { data: bowlerLeaguesResponse, isLoading: loadingBowlerLeagues, error: bowlerLeaguesError, refetch: refetchBowlerLeagues } = useQuery<ApiResponse<BowlerLeague[]>>({
    queryKey: ["/api/bowler-leagues"],
    staleTime: 1000 * 30,
    retry: false,
  });

  const { data: userResponse } = useQuery<ApiResponse<User>>({
    queryKey: ["/api/user"],
    staleTime: 1000 * 60 * 5,
    retry: false,
  });

  if (loadingLeagues || loadingPayments || loadingBowlerLeagues) {
    return <Layout><DashboardSkeleton /></Layout>;
  }

  const error = leaguesError || paymentsError || bowlerLeaguesError;
  if (error) {
    return <Layout><PageErrorState message={`Error loading data: ${(error as Error).message}`} onRetry={() => { refetchLeagues(); refetchPayments(); refetchBowlerLeagues(); }} /></Layout>;
  }

  const leagues = leaguesResponse?.data || [];
  const payments = paymentsResponse?.data || [];
  const bowlerLeaguesData = bowlerLeaguesResponse?.data || [];

  const activeLeagues = leagues.filter((l: League) => l.active);
  const activeLeagueIds = new Set(activeLeagues.map((l: League) => l.id));
  const activeBowlerIds = new Set(
    bowlerLeaguesData
      .filter((bl: BowlerLeague) => bl.active && activeLeagueIds.has(bl.leagueId))
      .map((bl: BowlerLeague) => bl.bowlerId)
  );
  const activeBowlers = activeBowlerIds.size;
  const totalLeagues = activeLeagueIds.size;

  const { paidPayments } = getPaymentSummary(payments);
  const totalLineagePaid = paidPayments.reduce((sum, p) => sum + (p.lineageAmount ?? 0), 0);
  const totalPrizeFundPaid = paidPayments.reduce((sum, p) => sum + (p.prizeFundAmount ?? 0), 0);
  const totalCollected = paidPayments.reduce((sum, p) => sum + p.amount, 0);
  const totalExpected = payments.reduce((sum, p) => sum + p.amount, 0);
  const collectionRate = totalExpected > 0 ? Math.round((totalCollected / totalExpected) * 100) : 100;

  const leagueHealthData = activeLeagues.map(league => {
    const leagueBowlerCount = new Set(
      bowlerLeaguesData
        .filter((bl: BowlerLeague) => bl.leagueId === league.id && bl.active)
        .map((bl: BowlerLeague) => bl.bowlerId)
    ).size;

    const leaguePayments = payments.filter(p => p.leagueId === league.id);
    const leaguePaid = leaguePayments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
    const leagueTotal = leaguePayments.reduce((s, p) => s + p.amount, 0);
    const rate = leagueTotal > 0 ? Math.round((leaguePaid / leagueTotal) * 100) : 100;

    return {
      name: league.name,
      bowlerCount: leagueBowlerCount,
      collectionRate: rate,
    };
  }).filter(l => l.bowlerCount > 0);

  const userName = userResponse?.data?.name?.split(' ')[0] || "Admin";

  return (
    <Layout>
      <ErrorBoundary level="section">
        <div className="flex flex-col gap-6">
          <div className="flex justify-between items-end">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Welcome back, {userName}
              </h1>
              <p className="text-slate-500 mt-1">
                Here's what's happening with your leagues today.
              </p>
            </div>
            <Link href="/reports">
              <button className="px-4 py-2 bg-[#0f172a] text-white text-sm font-medium rounded-md hover:bg-slate-800 transition-colors shadow-sm">
                Generate Report
              </button>
            </Link>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Link href="/leagues">
              <div className="bg-white p-3.5 border border-slate-200 rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-pointer">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Active Leagues
                </div>
                <div className="flex items-end justify-between">
                  <div className="text-2xl font-bold text-slate-900">{totalLeagues}</div>
                  <Activity className="w-3.5 h-3.5 text-emerald-500 mb-1" />
                </div>
              </div>
            </Link>
            <Link href="/bowlers">
              <div className="bg-white p-3.5 border border-slate-200 rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-pointer">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Active Bowlers
                </div>
                <div className="flex items-end justify-between">
                  <div className="text-2xl font-bold text-slate-900">{activeBowlers}</div>
                  <div className="text-xs font-medium text-emerald-600 flex items-center">
                    <ArrowUpRight className="w-3 h-3 mr-0.5" />
                  </div>
                </div>
              </div>
            </Link>
            <Link href="/payments">
              <div className="bg-white p-3.5 border border-slate-200 rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-pointer">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Lineage Collected
                </div>
                <div className="flex items-end justify-between">
                  <div className="text-2xl font-bold text-slate-900">{formatCurrency(totalLineagePaid)}</div>
                </div>
              </div>
            </Link>
            <Link href="/payments">
              <div className="bg-white p-3.5 border border-slate-200 rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-pointer">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Prize Fund
                </div>
                <div className="flex items-end justify-between">
                  <div className="text-2xl font-bold text-slate-900">{formatCurrency(totalPrizeFundPaid)}</div>
                  <DollarSign className="w-3.5 h-3.5 text-slate-400 mb-1" />
                </div>
              </div>
            </Link>
            <div className="bg-white p-3.5 border border-slate-200 rounded-lg shadow-sm hover:shadow-md transition-shadow flex items-center justify-between">
              <div>
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Collection Rate
                </div>
                <div className="text-2xl font-bold text-slate-900">{collectionRate}%</div>
              </div>
              <CollectionRateCircle rate={collectionRate} />
            </div>
          </div>

          <ErrorBoundary level="section">
            <PastDueBowlersSection />
          </ErrorBoundary>

          {leagueHealthData.length > 0 && (
            <div>
              <h2 className="text-lg font-bold text-slate-900 mb-3">League Health</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {leagueHealthData.map((league, idx) => (
                  <LeagueHealthCard key={idx} {...league} />
                ))}
              </div>
            </div>
          )}
        </div>
      </ErrorBoundary>
    </Layout>
  );
}
