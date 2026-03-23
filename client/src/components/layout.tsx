import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Home, Users, CreditCard, ChevronLeft, ChevronRight, Trophy, ClipboardPlus, LayoutDashboard, Loader2, Building2, MapPin, Mail, Plug, Menu, Bell, Search, ChevronDown, Settings } from "lucide-react";
import { useState, useEffect, Suspense, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import type { League, Location, ApiResponse, Organization, User } from "@shared/schema";
import { ErrorBoundary } from "@/components/error-boundary";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import { UserProfileMenu } from "@/components/user-profile-menu";


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
    console.warn('[Layout] localStorage access error:', error);
  }
};

interface NavItem {
  icon: typeof LayoutDashboard;
  label: string;
  href: string;
  hasDropdown?: boolean;
  adminOnly?: boolean;
  orgAdminOnly?: boolean;
  subItems?: NavItem[];
}

const navItems: NavItem[] = [
  {
    icon: Home,
    label: "Dashboard",
    href: "/"
  },
  {
    icon: Building2,
    label: "Organizations",
    href: "/organizations",
    adminOnly: true
  },
  {
    icon: MapPin,
    label: "Locations",
    href: "/locations",
    adminOnly: true
  },
  {
    icon: Users,
    label: "Users",
    href: "/users",
    adminOnly: true
  },
  {
    icon: Mail,
    label: "Email Templates",
    href: "/email-templates",
    adminOnly: true
  },
  {
    icon: Trophy,
    label: "Leagues",
    href: "/leagues"
  },
  {
    icon: Users,
    label: "Bowlers",
    href: "/bowlers"
  },
  {
    icon: CreditCard,
    label: "Payments",
    href: "/payments"
  },
  {
    icon: ClipboardPlus,
    label: "Reports",
    href: "/reports"
  },
  {
    icon: Plug,
    label: "Integrations",
    href: "/integrations",
    orgAdminOnly: true
  },
  {
    icon: LayoutDashboard,
    label: "Bowler Dashboard",
    href: "/bowler-dashboard"
  }
];

const pageLabels: Record<string, string> = {
  "/": "Overview",
  "/home": "Overview",
  "/organizations": "Organizations",
  "/locations": "Locations",
  "/users": "Users",
  "/email-templates": "Email Templates",
  "/leagues": "Leagues",
  "/bowlers": "Bowlers",
  "/payments": "Payments",
  "/reports": "Reports",
  "/integrations": "Integrations",
  "/bowler-dashboard": "Bowler Dashboard",
  "/profile": "Profile",
};

function getPageLabel(path: string): string {
  if (pageLabels[path]) return pageLabels[path];
  if (path.startsWith("/leagues/")) return "League Details";
  if (path.startsWith("/bowlers/")) return "Bowler Details";
  if (path.startsWith("/teams/")) return "Team Details";
  if (path.startsWith("/reports/")) return "Report";
  return "Page";
}

function getParentLabel(path: string): string | null {
  if (path === "/" || path === "/home") return null;
  if (path.startsWith("/leagues/")) return "Leagues";
  if (path.startsWith("/bowlers/")) return "Bowlers";
  if (path.startsWith("/teams/")) return "Teams";
  if (path.startsWith("/reports/")) return "Reports";
  return "Dashboard";
}

const LeagueLoadingFallback = () => (
  <div className="w-[200px] p-4 flex items-center justify-center">
    <Loader2 className="h-4 w-4 animate-spin" />
  </div>
);

const LeaguesDropdownContent = () => {
  const { data: leaguesResponse, isLoading } = useQuery<ApiResponse<League[]>>({
    queryKey: ["/api/leagues"],
    staleTime: 1000 * 60 * 5,
  });

  const { data: locationsResponse } = useQuery<ApiResponse<Location[]>>({
    queryKey: ["/api/locations"],
    staleTime: 1000 * 60 * 5,
  });

  const leagues = (leaguesResponse?.data || []).filter((l: League) => l.active);
  const locationsList = locationsResponse?.data || [];
  const locationMap = locationsList.reduce((acc, loc) => { acc[loc.id] = loc.name; return acc; }, {} as Record<number, string>);
  const hasLocations = locationsList.length > 0;

  if (isLoading) return <LeagueLoadingFallback />;

  const grouped = leagues.reduce((acc, league) => {
    const key = league.locationId ? locationMap[league.locationId] || 'Other' : 'Unassigned';
    if (!acc[key]) acc[key] = [];
    acc[key].push(league);
    return acc;
  }, {} as Record<string, League[]>);

  return (
    <div className="w-[220px] p-2">
      {hasLocations ? (
        Object.entries(grouped).map(([locationName, locationLeagues]) => (
          <div key={locationName}>
            <div className="px-4 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {locationName}
            </div>
            {locationLeagues.map((league: League) => (
              <Link key={league.id} href={`/leagues/${league.id}`}>
                <button className="block w-full text-left px-4 py-2 text-sm rounded-md hover:bg-accent transition-colors">
                  {league.name}
                </button>
              </Link>
            ))}
          </div>
        ))
      ) : (
        leagues.map((league: League) => (
          <Link key={league.id} href={`/leagues/${league.id}`}>
            <button className="block w-full text-left px-4 py-2 text-sm rounded-md hover:bg-accent transition-colors">
              {league.name}
            </button>
          </Link>
        ))
      )}
      <div className="border-t mt-2 pt-2">
        <Link href="/leagues">
          <button className="block w-full text-left px-4 py-2 text-sm rounded-md hover:bg-accent transition-colors font-medium">
            View All Leagues
          </button>
        </Link>
      </div>
    </div>
  );
};


const LoadingFallback = () => (
  <div className="p-4 flex items-center justify-center">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

export function Layout({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(() =>
    getStoredValue("sidebarCollapsed", false)
  );

  const { data: currentUserResponse } = useQuery<ApiResponse<User>>({
    queryKey: ["/api/user"],
    staleTime: 1000 * 60 * 5,
  });

  const userOrgId = currentUserResponse?.data?.organizationId;

  const { data: organizationResponse } = useQuery<ApiResponse<Organization>>({
    queryKey: ["/api/organizations", userOrgId],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/${userOrgId}`, {
        credentials: "include",
        headers: { "Accept": "application/json" }
      });
      if (!res.ok) throw new Error(`Failed to fetch organization: ${res.status}`);
      return res.json();
    },
    enabled: !!userOrgId,
    staleTime: 1000 * 60 * 5,
  });

  const { data: perfectGameOrgResponse } = useQuery<ApiResponse<Organization>>({
    queryKey: ["/api/organizations/slug/perfect-game"],
    staleTime: 1000 * 60 * 5,
  });

  const userRole = currentUserResponse?.data?.role;
  const isAdmin = userRole === 'system_admin';
  const isSystemAdmin = userRole === 'system_admin';
  const isOrgAdmin = userRole === 'org_admin';
  const canSeeOrgAdminItems = isSystemAdmin || (isOrgAdmin && !!userOrgId);

  const toggleSidebar = useCallback(() => {
    setIsCollapsed((prev: boolean) => !prev);
  }, []);

  useEffect(() => {
    setStoredValue("sidebarCollapsed", isCollapsed);
  }, [isCollapsed]);

  const [location] = useLocation();

  const organization = organizationResponse?.data || perfectGameOrgResponse?.data;
  const orgName = organization?.name || "LeagueVault";
  const orgInitials = orgName.split(/\s+/).map(w => w[0]).join("").substring(0, 2).toUpperCase();

  const parentLabel = getParentLabel(location);
  const pageLabel = getPageLabel(location);

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans flex overflow-hidden">
      <aside
        className={cn(
          "transition-all duration-300 ease-in-out bg-[#0f172a] text-slate-300 flex flex-col border-r border-slate-800 shadow-xl z-50 shrink-0 fixed top-0 bottom-0 left-0",
          isCollapsed ? "w-20" : "w-64"
        )}
      >
        <div className="border-b border-slate-800/60 shrink-0">
          <div className="flex items-center justify-center px-3 py-3">
            {organization?.logo ? (
              <img
                src={organization.logo}
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

        <ErrorBoundary level="section" onReset={() => window.location.reload()}>
          <Suspense fallback={<LoadingFallback />}>
            <nav className="flex-1 py-6 px-3 flex flex-col gap-1 overflow-y-auto">
              {navItems.map((item) => {
                if (item.adminOnly && !isAdmin) return null;
                if (item.orgAdminOnly && !canSeeOrgAdminItems) return null;
                if (item.href === '/bowler-dashboard' && !isSystemAdmin) return null;

                const isActive = location === item.href ||
                  (item.href !== "/" && location.startsWith(item.href + "/"));
                const isDashboardActive = item.href === "/" && (location === "/" || location === "/home");

                if (item.hasDropdown && !isCollapsed) {
                  return (
                    <NavigationMenu key={item.href}>
                      <NavigationMenuList>
                        <NavigationMenuItem>
                          <NavigationMenuTrigger
                            className={cn(
                              "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-all duration-200 w-full",
                              isActive
                                ? "bg-indigo-500/10 text-indigo-400"
                                : "text-slate-300 hover:bg-slate-800 hover:text-white"
                            )}
                          >
                            <item.icon className={cn("w-5 h-5 shrink-0", isActive ? "text-indigo-400" : "text-slate-400")} />
                            {item.label}
                          </NavigationMenuTrigger>
                          <NavigationMenuContent>
                            <Suspense fallback={<LeagueLoadingFallback />}>
                              <LeaguesDropdownContent />
                            </Suspense>
                          </NavigationMenuContent>
                        </NavigationMenuItem>
                      </NavigationMenuList>
                    </NavigationMenu>
                  );
                }

                return (
                  <Link key={item.href} href={item.href}>
                    <button
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md transition-all duration-200 group",
                        isCollapsed ? "justify-center p-2.5" : "px-3 py-2.5",
                        (isActive || isDashboardActive)
                          ? "bg-indigo-500/10 text-indigo-400"
                          : "text-slate-300 hover:bg-slate-800 hover:text-white"
                      )}
                      title={isCollapsed ? item.label : undefined}
                    >
                      <item.icon className={cn(
                        "w-5 h-5 shrink-0",
                        (isActive || isDashboardActive) ? "text-indigo-400" : "text-slate-400 group-hover:text-slate-300"
                      )} />
                      {!isCollapsed && (
                        <span className="font-medium text-sm">{item.label}</span>
                      )}
                    </button>
                  </Link>
                );
              })}
            </nav>
          </Suspense>
        </ErrorBoundary>

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
        isCollapsed ? "ml-20" : "ml-64"
      )}>
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.02)] z-10 sticky top-0">
          <div className="flex items-center text-slate-500">
            {parentLabel ? (
              <>
                <span className="text-sm font-medium">{parentLabel}</span>
                <ChevronRight className="w-4 h-4 mx-2 text-slate-300" />
                <span className="text-sm font-medium text-slate-900">{pageLabel}</span>
              </>
            ) : (
              <>
                <span className="text-sm font-medium">Dashboard</span>
                <ChevronRight className="w-4 h-4 mx-2 text-slate-300" />
                <span className="text-sm font-medium text-slate-900">{pageLabel}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-5">
            <div className="relative group hidden md:block">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
              <input
                type="text"
                placeholder="Search leagues or bowlers..."
                className="pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all w-64"
              />
            </div>

            <button className="relative p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-colors">
              <Bell className="w-5 h-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 md:p-8">
          <div className="max-w-[1400px] mx-auto">
            <ErrorBoundary level="section" onReset={() => window.location.reload()}>
              <Suspense fallback={<LoadingFallback />}>
                {children}
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      </main>
    </div>
  );
}
