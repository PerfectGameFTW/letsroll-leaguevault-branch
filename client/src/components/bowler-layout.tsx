import { FC, ReactNode, useState, useEffect, Suspense } from "react";
import { useLocation, Link } from "wouter";
import { LayoutDashboard, History, UserCircle, ChevronRight, Menu, Bell, Loader2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Organization, User, ApiResponse } from "@shared/schema";
import { UserProfileMenu } from "@/components/user-profile-menu";
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

const getStoredValue = (key: string, defaultValue: any) => {
  try {
    if (typeof window === 'undefined') return defaultValue;
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch {
    return defaultValue;
  }
};

const setStoredValue = (key: string, value: any) => {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch (error) {
    console.warn('[BowlerLayout] localStorage access error:', error);
  }
};

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
      label: "Payment History",
      href: paymentHistoryHref,
      baseHref: "/payment-history",
    },
    {
      icon: UserCircle,
      label: "Profile Settings",
      href: "/profile",
      baseHref: "/profile",
    },
  ];
}

const pageLabels: Record<string, string> = {
  "/bowler-dashboard": "Overview",
  "/payment-history": "Payment History",
  "/profile": "Profile Settings",
};

function getPageLabel(path: string): string {
  if (pageLabels[path]) return pageLabels[path];
  if (path.startsWith("/payment-history")) return "Payment History";
  return "Page";
}

const LoadingFallback = () => (
  <div className="p-4 flex items-center justify-center">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

export const BowlerLayout: FC<BowlerLayoutProps> = ({ children, bowlerName, leagueName, currentLeagueId }) => {
  const [location] = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(() =>
    getStoredValue("bowlerSidebarCollapsed", false)
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const navItems = buildNavItems(currentLeagueId);

  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

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

  const toggleSidebar = () => {
    setIsCollapsed((prev: boolean) => !prev);
  };

  useEffect(() => {
    setStoredValue("bowlerSidebarCollapsed", isCollapsed);
  }, [isCollapsed]);

  const pageLabel = getPageLabel(location);

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans flex overflow-hidden">
      <aside
        className={cn(
          "transition-all duration-300 ease-in-out bg-[#0f172a] text-slate-300 flex flex-col border-r border-slate-800 shadow-xl z-50 shrink-0 fixed top-0 bottom-0 left-0",
          mobileOpen ? "flex w-64" : "hidden lg:flex",
          !mobileOpen && (isCollapsed ? "w-20" : "w-64")
        )}
      >
        <div className="border-b border-slate-800/60 shrink-0">
          <div className="flex items-center justify-center px-3 py-3">
            {(organization?.darkLogo || organization?.logo) ? (
              <img
                src={organization.darkLogo || organization.logo || ''}
                alt={orgName}
                className="w-full h-auto max-h-12 object-contain"
              />
            ) : (
              <div className="w-10 h-10 rounded-md bg-indigo-500 flex items-center justify-center shadow-sm">
                <span className="text-sm font-bold text-white">{orgInitials}</span>
              </div>
            )}
          </div>
          <div className="flex justify-end px-3 pb-2">
            <button
              onClick={toggleSidebar}
              className="p-1 rounded-md hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            >
              <Menu className="w-4 h-4" />
            </button>
          </div>
        </div>

        <nav className="flex-1 py-6 px-3 flex flex-col gap-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.baseHref || location.startsWith(item.baseHref + '?') || location.startsWith(item.baseHref + '/');

            return (
              <Link key={item.baseHref} href={item.href}>
                <button
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md transition-all duration-200 group",
                    isCollapsed ? "justify-center p-2.5" : "px-3 py-2.5",
                    isActive
                      ? "bg-indigo-500/10 text-indigo-400"
                      : "text-slate-300 hover:bg-slate-800 hover:text-white"
                  )}
                  title={isCollapsed ? item.label : undefined}
                >
                  <item.icon className={cn(
                    "w-5 h-5 shrink-0",
                    isActive ? "text-indigo-400" : "text-slate-400 group-hover:text-slate-300"
                  )} />
                  {!isCollapsed && (
                    <span className="font-medium text-sm">{item.label}</span>
                  )}
                </button>
              </Link>
            );
          })}

          {isSystemAdmin && (
            <>
              <div className={cn("border-t border-slate-800/60 my-3", isCollapsed && "mx-1")} />
              <Link href="/">
                <button
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md transition-all duration-200 group",
                    isCollapsed ? "justify-center p-2.5" : "px-3 py-2.5",
                    "text-slate-300 hover:bg-slate-800 hover:text-white"
                  )}
                  title={isCollapsed ? "Admin Dashboard" : undefined}
                >
                  <ArrowRight className="w-5 h-5 shrink-0 text-slate-400 group-hover:text-slate-300 rotate-180" />
                  {!isCollapsed && (
                    <span className="font-medium text-sm">Admin Dashboard</span>
                  )}
                </button>
              </Link>
            </>
          )}
        </nav>

        <div className="p-4 border-t border-slate-800/60 shrink-0">
          {currentUserResponse?.data && (
            <div className={cn("flex items-center", isCollapsed ? "justify-center" : "gap-3")}>
              <UserProfileMenu user={currentUserResponse.data} />
              {!isCollapsed && (
                <div className="flex flex-col overflow-hidden">
                  <span className="text-sm font-medium text-white truncate">
                    {currentUserResponse.data.name || currentUserResponse.data.email}
                  </span>
                  <span className="text-xs text-slate-500 truncate">
                    {currentUserResponse.data.email}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      <main className={cn(
        "flex-1 flex flex-col min-h-screen transition-all duration-300",
        isCollapsed ? "lg:ml-20" : "lg:ml-64"
      )}>
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:px-8 shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.02)] z-10 sticky top-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(prev => !prev)}
              className="lg:hidden p-2 rounded-md hover:bg-slate-100 text-slate-500 transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center text-slate-500">
              <span className="text-sm font-medium">My Account</span>
              <ChevronRight className="w-4 h-4 mx-2 text-slate-300" />
              <span className="text-sm font-medium text-slate-900">{pageLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-5">
            <button className="relative p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-colors">
              <Bell className="w-5 h-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <div className="max-w-[1400px] mx-auto">
            <ErrorBoundary level="section" onReset={() => window.location.reload()}>
              <Suspense fallback={<LoadingFallback />}>
                {children}
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      </main>

      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden transition-opacity duration-300"
          onClick={() => setMobileOpen(false)}
        />
      )}
    </div>
  );
};
