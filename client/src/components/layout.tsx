import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Home, Users, CreditCard, ChevronLeft, ChevronRight, Trophy, ClipboardPlus, LayoutDashboard, Loader2, ShieldCheck, Building2 } from "lucide-react";
import { useState, useEffect, Suspense, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import type { League, ApiResponse, Organization, User } from "@shared/schema";
import { ErrorBoundary } from "react-error-boundary";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import { UserProfileMenu } from "@/components/user-profile-menu";
import leagueVaultLogo from "../assets/images/league-vault-logo.png";

// Safe localStorage access function with memoization
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
  subItems?: NavItem[];
}

const navItems: NavItem[] = [
  {
    icon: Home,
    label: "Dashboard",
    href: "/"
  },
  {
    icon: Trophy,
    label: "Leagues",
    href: "/leagues",
    hasDropdown: true
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
    icon: LayoutDashboard,
    label: "Bowler Dashboard",
    href: "/bowler-dashboard"
  }
];

const LeagueLoadingFallback = () => (
  <div className="w-[200px] p-4 flex items-center justify-center">
    <Loader2 className="h-4 w-4 animate-spin" />
  </div>
);

const LeaguesDropdownContent = () => {
  const { data: leaguesResponse, isLoading } = useQuery<ApiResponse<League[]>>({
    queryKey: ["/api/leagues"],
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  const leagues = leaguesResponse?.data || [];

  if (isLoading) return <LeagueLoadingFallback />;

  return (
    <div className="w-[200px] p-2">
      {leagues.map((league: League) => (
        <Link key={league.id} href={`/leagues/${league.id}`}>
          <button className="block w-full text-left px-4 py-2 text-sm rounded-md hover:bg-accent transition-colors">
            {league.name}
          </button>
        </Link>
      ))}
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

const ErrorFallback = ({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary: () => void }) => {
  return (
    <div className="p-4 rounded-md bg-destructive/10 text-destructive space-y-2">
      <p className="font-medium">Something went wrong:</p>
      <p className="text-sm">{error.message}</p>
      <Button
        variant="outline"
        size="sm"
        onClick={resetErrorBoundary}
        className="mt-2"
      >
        Try again
      </Button>
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

  // Fetch current user to check for admin status and organization
  const { data: currentUserResponse } = useQuery<ApiResponse<User>>({
    queryKey: ["/api/user"],
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });
  
  // Get user's organization ID
  const userOrgId = currentUserResponse?.data?.organizationId;
  
  // Fetch organization details if user has an organization
  const { data: organizationResponse } = useQuery<ApiResponse<Organization>>({
    queryKey: ["/api/organizations", userOrgId],
    enabled: !!userOrgId,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });
  
  // Fallback to fetch Perfect Game organization for testing logo
  const { data: perfectGameOrgResponse } = useQuery<ApiResponse<Organization>>({
    queryKey: ["/api/organizations/slug/perfect-game"],
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });
  
  // Log organization data when it changes
  useEffect(() => {
    if (organizationResponse?.data) {
      console.log("[Layout] User organization data:", 
                  organizationResponse.data.name, 
                  organizationResponse.data.logo ? "Logo exists" : "No logo");
    }
    
    if (perfectGameOrgResponse?.data) {
      console.log("[Layout] Perfect Game organization data:", 
                  perfectGameOrgResponse.data.name, 
                  perfectGameOrgResponse.data.logo ? "Logo exists" : "No logo");
    }
  }, [organizationResponse, perfectGameOrgResponse]);

  const isAdmin = currentUserResponse?.data?.isAdmin || false;
  const isOrganizationAdmin = currentUserResponse?.data?.isOrganizationAdmin || false;
  const hasOrganization = !!currentUserResponse?.data?.organizationId;
  // System admin is someone who has both admin and organization admin privileges
  const isSystemAdmin = isAdmin && isOrganizationAdmin;

  const toggleSidebar = useCallback(() => {
    setIsCollapsed((prev: boolean) => !prev);
  }, []);

  useEffect(() => {
    setStoredValue("sidebarCollapsed", isCollapsed);
  }, [isCollapsed]);

  const sidebarWidth = useMemo(() =>
    isCollapsed ? "w-16" : "w-64"
  , [isCollapsed]);

  const mainContentPadding = useMemo(() =>
    isCollapsed ? "pl-16" : "pl-64"
  , [isCollapsed]);

  const [location] = useLocation();

  return (
    <div className="min-h-screen bg-gray-50">
      <div
        className={cn(
          "fixed top-0 bottom-0 left-0 z-50 bg-white border-r transition-all duration-300",
          sidebarWidth
        )}
      >
        <div className="flex flex-col h-full">
          <div className="flex-1 flex flex-col pt-5 pb-4">
            <div className={cn(
              "flex items-center px-4",
              isCollapsed ? "justify-center" : "justify-end"
            )}>
              <Button
                variant="ghost"
                size="sm"
                className={cn("p-0 w-8 h-8", isCollapsed && "absolute right-2 top-5")}
                onClick={toggleSidebar}
                aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <ChevronLeft className="h-4 w-4" />
                )}
              </Button>
            </div>
            <ErrorBoundary
              FallbackComponent={ErrorFallback}
              onReset={() => {
                window.location.reload();
              }}
            >
              <Suspense fallback={<LoadingFallback />}>
                <nav className="mt-8 flex-1 space-y-1 px-2">
                  <div className="space-y-2">
                    {navItems.map((item) => {
                      // Show Bowler Dashboard only for system admins
                      if (item.href === '/bowler-dashboard' && !isSystemAdmin) {
                        return null;
                      }
                      
                      const isActive = location === item.href;
                      if (item.hasDropdown && !isCollapsed) {
                        return (
                          <NavigationMenu key={item.href}>
                            <NavigationMenuList>
                              <NavigationMenuItem>
                                <NavigationMenuTrigger
                                  className={cn(
                                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all hover:bg-accent",
                                    isActive && "bg-accent"
                                  )}
                                >
                                  <item.icon className="h-4 w-4" />
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
                              "flex w-full items-center gap-3 rounded-lg transition-all hover:bg-accent",
                              isCollapsed ? "justify-center p-2" : "px-3 py-2",
                              isActive && "bg-accent"
                            )}
                            title={isCollapsed ? item.label : undefined}
                          >
                            <item.icon className="h-4 w-4" />
                            {!isCollapsed && (
                              <>
                                <span className="text-sm">{item.label}</span>
                                {isActive && <ChevronRight className="ml-auto h-4 w-4" />}
                              </>
                            )}
                          </button>
                        </Link>
                      );
                    })}
                    
                    {/* Admin navigation links - only visible to admin users */}
                    {isAdmin && (
                      <>
                        <Link href="/admin">
                          <button
                            className={cn(
                              "flex w-full items-center gap-3 rounded-lg transition-all hover:bg-accent",
                              isCollapsed ? "justify-center p-2" : "px-3 py-2",
                              location === "/admin" && "bg-accent"
                            )}
                            title={isCollapsed ? "Admin" : undefined}
                          >
                            <ShieldCheck className="h-4 w-4" />
                            {!isCollapsed && (
                              <>
                                <span className="text-sm">Admin</span>
                                {location === "/admin" && <ChevronRight className="ml-auto h-4 w-4" />}
                              </>
                            )}
                          </button>
                        </Link>
                        
                        <Link href="/organizations">
                          <button
                            className={cn(
                              "flex w-full items-center gap-3 rounded-lg transition-all hover:bg-accent",
                              isCollapsed ? "justify-center p-2" : "px-3 py-2",
                              location === "/organizations" && "bg-accent"
                            )}
                            title={isCollapsed ? "Organizations" : undefined}
                          >
                            <Building2 className="h-4 w-4" />
                            {!isCollapsed && (
                              <>
                                <span className="text-sm">Organizations</span>
                                {location === "/organizations" && <ChevronRight className="ml-auto h-4 w-4" />}
                              </>
                            )}
                          </button>
                        </Link>
                      </>
                    )}
                  </div>
                </nav>
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      </div>

      <div className={cn("transition-all duration-300", mainContentPadding)}>
        <header className="py-4 px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto flex justify-between items-center">
          {/* Organization logo in the top left */}
          <div className="flex items-center">
            {(organizationResponse?.data?.logo || perfectGameOrgResponse?.data?.logo) ? (
              <img
                src={organizationResponse?.data?.logo || perfectGameOrgResponse?.data?.logo}
                alt={(organizationResponse?.data?.name || perfectGameOrgResponse?.data?.name || "Organization") + " Logo"}
                className="h-10 w-auto object-contain"
                onError={(e) => {
                  console.error("[Layout] Failed to load organization logo in header:", e);
                  e.currentTarget.src = leagueVaultLogo;
                }}
              />
            ) : (
              <img
                src={leagueVaultLogo}
                alt="LeagueVault Logo"
                className="h-10 w-auto object-contain"
              />
            )}
          </div>
          
          {/* User profile in the top right */}
          {currentUserResponse?.data && (
            <UserProfileMenu
              user={currentUserResponse.data}
            />
          )}
        </header>
        <main className="py-2 px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto">
          <ErrorBoundary
            FallbackComponent={ErrorFallback}
            onReset={() => {
              window.location.reload();
            }}
          >
            <Suspense fallback={<LoadingFallback />}>
              {children}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}