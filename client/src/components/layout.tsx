import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Home, Users, CreditCard, Trophy, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, FileText, BarChart3, LogIn, UserPlus } from "lucide-react";
import { useState, useEffect, Suspense, memo } from "react";
import { Button } from "./ui/button";
import { useQuery } from "@tanstack/react-query";
import type { League } from "@shared/schema";
import { ErrorBoundary } from "react-error-boundary";

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
    console.warn('localStorage access error:', error);
  }
};

// Separate navigation arrays
const baseNavigation = [
  { name: "Dashboard", href: "/", icon: Home },
  { name: "Bowlers", href: "/bowlers", icon: Users },
  { name: "Payments", href: "/payments", icon: CreditCard },
  { name: "Reports", href: "/reports", icon: FileText },
  { name: "Sign Up", href: "/sign-up", icon: UserPlus },
  { name: "Login", href: "/login", icon: LogIn },
];

const bottomNavigation = [
  { name: "Bowler Dashboard", href: "/bowler-dashboard", icon: BarChart3 },
];

// Memoized navigation items to prevent unnecessary re-renders
const NavigationItem = memo(({ item, isActive, isCollapsed }: {
  item: typeof baseNavigation[0],
  isActive: boolean,
  isCollapsed: boolean
}) => {
  const Icon = item.icon;
  return (
    <Link href={item.href}>
      <span
        className={cn(
          "group flex items-center px-2 py-2 text-sm font-medium rounded-md cursor-pointer",
          isActive
            ? "bg-primary text-primary-foreground"
            : "text-gray-600 hover:bg-gray-50"
        )}
        title={isCollapsed ? item.name : undefined}
      >
        <Icon
          className={cn(
            "h-5 w-5 flex-shrink-0",
            isActive
              ? "text-primary-foreground"
              : "text-gray-400",
            isCollapsed ? "mx-auto" : "mr-3"
          )}
        />
        {!isCollapsed && item.name}
      </span>
    </Link>
  );
});

// Update LeaguesSection component with proper TypeScript types and loading state
const LeaguesSection = memo(({
  isCollapsed,
  leagues = [], // Provide default empty array
  isInLeaguesSection,
  location,
  isLoading
}: {
  isCollapsed: boolean,
  leagues: League[],
  isInLeaguesSection: boolean,
  location: string,
  isLoading: boolean
}) => {
  const [isLeaguesExpanded, setIsLeaguesExpanded] = useState(
    getStoredValue("leaguesExpanded", false)
  );

  useEffect(() => {
    setStoredValue("leaguesExpanded", isLeaguesExpanded);
  }, [isLeaguesExpanded]);

  // Handle loading state
  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className="h-10 bg-gray-200 rounded-md mb-2"></div>
      </div>
    );
  }

  // Safety check for leagues data
  if (!Array.isArray(leagues)) {
    console.warn('[Layout] Invalid leagues data:', leagues);
    return null;
  }

  if (isCollapsed) {
    return (
      <Link href="/leagues">
        <span
          className={cn(
            "group flex items-center px-2 py-2 text-sm font-medium rounded-md cursor-pointer",
            isInLeaguesSection
              ? "bg-primary text-primary-foreground"
              : "text-gray-600 hover:bg-gray-50"
          )}
          title="Leagues"
        >
          <Trophy
            className={cn(
              "h-5 w-5 flex-shrink-0",
              isInLeaguesSection
                ? "text-primary-foreground"
                : "text-gray-400",
              "mx-auto"
            )}
          />
        </span>
      </Link>
    );
  }

  return (
    <div>
      <button
        className={cn(
          "w-full flex items-center justify-between px-2 py-2 text-sm font-medium rounded-md cursor-pointer",
          isInLeaguesSection
            ? "bg-primary text-primary-foreground"
            : "text-gray-600 hover:bg-gray-50"
        )}
        onClick={() => setIsLeaguesExpanded(!isLeaguesExpanded)}
      >
        <div className="flex items-center">
          <Trophy className={cn(
            "h-5 w-5 flex-shrink-0 mr-3",
            isInLeaguesSection
              ? "text-primary-foreground"
              : "text-gray-400"
          )} />
          Leagues
        </div>
        {isLeaguesExpanded ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </button>
      {isLeaguesExpanded && leagues.length > 0 && (
        <div className="ml-9 mt-1 space-y-1">
          <Link href="/leagues">
            <span className={cn(
              "block px-2 py-1.5 text-sm rounded-md cursor-pointer",
              location === "/leagues"
                ? "bg-primary/10 text-primary font-medium"
                : "text-gray-600 hover:bg-gray-50"
            )}>
              All Leagues
            </span>
          </Link>
          {leagues.map((league) => (
            <Link
              key={league.id}
              href={`/leagues/${league.id}`}
            >
              <span className={cn(
                "block px-2 py-1.5 text-sm rounded-md cursor-pointer",
                location === `/leagues/${league.id}`
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-gray-600 hover:bg-gray-50"
              )}>
                {league.name}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
});

const ErrorFallback = ({ error }: { error: Error }) => {
  return (
    <div className="p-4 text-sm text-red-500">
      Error loading content: {error.message}
    </div>
  );
};

interface LeaguesResponse {
  success: boolean;
  data: League[];
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(() =>
    getStoredValue("sidebarCollapsed", false)
  );

  const { data: leaguesResponse, error: leaguesError, isLoading } = useQuery<LeaguesResponse>({
    queryKey: ["/api/leagues"],
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: 2, // Only retry twice to avoid infinite retries
    retryDelay: 1000, // Wait 1 second between retries
  });

  // Add debug logging
  console.log('[Layout] Leagues response:', leaguesResponse);
  if (leaguesError) {
    console.error('[Layout] Error loading leagues:', leaguesError);
  }

  // Ensure leagues is always an array, even when the response is loading or errored
  const leagues = leaguesResponse?.success && Array.isArray(leaguesResponse?.data)
    ? leaguesResponse.data
    : [];

  useEffect(() => {
    setStoredValue("sidebarCollapsed", isCollapsed);
  }, [isCollapsed]);

  const isInLeaguesSection = location.startsWith('/leagues') ||
    leagues.some(league => location.startsWith(`/leagues/${league.id}`));

  return (
    <div className="min-h-screen bg-gray-50">
      <div
        className={cn(
          "fixed top-0 bottom-0 left-0 z-50 bg-white border-r transition-all duration-300",
          isCollapsed ? "w-16" : "w-64"
        )}
      >
        <div className="flex flex-col h-full">
          <div className="flex-1 flex flex-col pt-5 pb-4">
            <div className={cn(
              "flex items-center px-4",
              isCollapsed ? "justify-center" : "justify-between"
            )}>
              {!isCollapsed && (
                <h1 className="text-xl font-bold text-gray-900">
                  League Manager
                </h1>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="p-0 w-8 h-8"
                onClick={() => setIsCollapsed(!isCollapsed)}
              >
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <ChevronLeft className="h-4 w-4" />
                )}
              </Button>
            </div>
            <ErrorBoundary FallbackComponent={ErrorFallback}>
              <Suspense fallback={<div className="p-4">Loading...</div>}>
                <nav className="mt-8 flex-1 space-y-1 px-2 flex flex-col">
                  <div className="flex-1 space-y-1">
                    {baseNavigation.map((item) => (
                      <NavigationItem
                        key={item.name}
                        item={item}
                        isActive={location === item.href}
                        isCollapsed={isCollapsed}
                      />
                    ))}

                    {/* Only render LeaguesSection when we have finished loading or have data */}
                    {(!isLoading || leagues.length > 0) && !leaguesError && (
                      <LeaguesSection
                        isCollapsed={isCollapsed}
                        leagues={leagues}
                        isInLeaguesSection={isInLeaguesSection}
                        location={location}
                        isLoading={isLoading}
                      />
                    )}

                    {bottomNavigation.map((item) => (
                      <NavigationItem
                        key={item.name}
                        item={item}
                        isActive={location === item.href}
                        isCollapsed={isCollapsed}
                      />
                    ))}
                  </div>
                </nav>
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      </div>

      <div className={cn("transition-all duration-300", isCollapsed ? "pl-16" : "pl-64")}>
        {!isCollapsed && (
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={() => setIsCollapsed(true)}
          />
        )}
        <main className="py-6 px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto">
          <ErrorBoundary FallbackComponent={ErrorFallback}>
            <Suspense fallback={<div>Loading...</div>}>
              {children}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}