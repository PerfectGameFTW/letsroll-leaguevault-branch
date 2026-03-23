import { FC, ReactNode, Suspense } from "react";
import { useLocation, Link } from "wouter";
import { LayoutDashboard, History, UserCircle, Bell, Loader2, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Organization, User, ApiResponse } from "@shared/schema";
import { ErrorBoundary } from "@/components/error-boundary";

interface BowlerLayoutProps {
  children: ReactNode;
  bowlerName: string;
  leagueName: string;
  currentLeagueId?: number;
}

interface NavItem {
  icon: typeof LayoutDashboard;
  label: string;
  href: string;
  baseHref: string;
}

function buildNavItems(currentLeagueId?: number): NavItem[] {
  const paymentHistoryHref = currentLeagueId
    ? `/payment-history?leagueId=${currentLeagueId}`
    : '/payment-history';
  return [
    {
      icon: LayoutDashboard,
      label: "Overview",
      href: "/bowler-dashboard",
      baseHref: "/bowler-dashboard",
    },
    {
      icon: History,
      label: "History",
      href: paymentHistoryHref,
      baseHref: "/payment-history",
    },
    {
      icon: UserCircle,
      label: "Profile",
      href: "/profile",
      baseHref: "/profile",
    },
  ];
}

const LoadingFallback = () => (
  <div className="p-4 flex items-center justify-center">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

export const BowlerLayout: FC<BowlerLayoutProps> = ({ children, bowlerName, leagueName, currentLeagueId }) => {
  const [location] = useLocation();
  const navItems = buildNavItems(currentLeagueId);

  const { data: currentUserResponse } = useQuery<ApiResponse<User>>({
    queryKey: ["/api/user"],
    staleTime: 1000 * 60 * 5,
  });

  const { data: perfectGameOrgResponse } = useQuery<ApiResponse<Organization>>({
    queryKey: ["/api/organizations/slug/perfect-game"],
    staleTime: 1000 * 60 * 60,
    enabled: true
  });

  const userOrgId = currentUserResponse?.data?.organizationId;
  const { data: userOrgResponse } = useQuery<ApiResponse<Organization>>({
    queryKey: ["/api/organizations", userOrgId],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/${userOrgId}`, {
        credentials: "include",
        headers: { "Accept": "application/json" }
      });
      if (!res.ok) throw new Error(`Failed to fetch organization: ${res.status}`);
      return res.json();
    },
    staleTime: 1000 * 60 * 60,
    enabled: !!userOrgId,
    retry: false,
  });

  const organization = userOrgResponse?.data || perfectGameOrgResponse?.data;
  const orgName = organization?.name || "Organization";
  const orgInitials = orgName.split(/\s+/).map(w => w[0]).join("").substring(0, 2).toUpperCase();

  const isSystemAdmin = currentUserResponse?.data?.role === 'system_admin';
  const user = currentUserResponse?.data;
  const userInitials = (user?.name || user?.email || "U")
    .split(/\s+/)
    .map(w => w[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

  return (
    <div className="flex flex-col h-screen max-h-screen bg-[#f8fafc] overflow-hidden relative font-sans">
      <header className="flex-none bg-white border-b border-slate-200 px-4 h-16 flex items-center justify-between z-10 shadow-sm">
        <div className="flex items-center">
          {(organization?.logo || organization?.darkLogo) ? (
            <img
              src={organization.logo || organization.darkLogo || ''}
              alt={orgName}
              className="h-9 w-auto max-w-[120px] object-contain"
            />
          ) : (
            <div className="w-9 h-9 bg-slate-900 rounded-lg flex items-center justify-center shadow-inner">
              <span className="text-white font-bold text-sm tracking-wider">{orgInitials}</span>
            </div>
          )}
        </div>

        <div className="hidden sm:block absolute left-1/2 transform -translate-x-1/2">
          <h1 className="text-base font-semibold text-slate-900">{bowlerName}</h1>
        </div>

        <div className="flex items-center gap-3">
          <button className="w-9 h-9 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 transition-colors relative">
            <Bell className="w-5 h-5" />
          </button>
          <Link href="/profile">
            <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm border border-indigo-200 cursor-pointer">
              {userInitials}
            </div>
          </Link>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto w-full">
        <div className="max-w-4xl mx-auto w-full px-4 sm:px-6 py-6 pb-24">
          {isSystemAdmin && (
            <Link href="/">
              <button className="flex items-center text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors mb-4">
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back to Admin Dashboard
              </button>
            </Link>
          )}
          <ErrorBoundary level="section" onReset={() => window.location.reload()}>
            <Suspense fallback={<LoadingFallback />}>
              {children}
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>

      <div className="flex-none bg-white border-t border-slate-200 z-20 shadow-[0_-4px_12px_rgba(0,0,0,0.02)]">
        <div className="max-w-md mx-auto flex justify-between px-2 h-16">
          {navItems.map((item) => {
            const isActive = location === item.baseHref || location.startsWith(item.baseHref + '?') || location.startsWith(item.baseHref + '/');
            return (
              <Link key={item.baseHref} href={item.href}>
                <button
                  className={cn(
                    "flex-1 flex flex-col items-center justify-center gap-1 min-w-[70px] h-16",
                    isActive ? "text-indigo-600" : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  <div className={cn(
                    "flex items-center justify-center w-10 h-8 rounded-full transition-all duration-200",
                    isActive ? "bg-indigo-50" : "bg-transparent"
                  )}>
                    <item.icon className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-semibold tracking-wide">{item.label}</span>
                </button>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
};
