import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Home, Users, CreditCard, ChevronLeft, ChevronRight, ChevronDown, Trophy, LayoutDashboard } from "lucide-react";
import { useState, useEffect, Suspense, memo } from "react";
import { Button } from "./ui/button";
import { useQuery } from "@tanstack/react-query";
import type { League } from "@shared/schema";
import { ErrorBoundary } from "react-error-boundary";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";

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

const baseNavigation = [
  { name: "Dashboard", href: "/", icon: Home },
  { name: "Leagues", href: "/leagues", icon: Trophy, hasDropdown: true },
  { name: "Bowlers", href: "/bowlers", icon: Users },
  { name: "Payments", href: "/payments", icon: CreditCard },
  { name: "Reports", href: "/reports", icon: LayoutDashboard },
];

const NavigationItem = memo(({ item, isActive, isCollapsed }: {
  item: typeof baseNavigation[0],
  isActive: boolean,
  isCollapsed: boolean
}) => {
  const Icon = item.icon;
  const { data: leaguesResponse } = useQuery<{ data: League[] }>({
    queryKey: ["/api/leagues"],
    enabled: item.hasDropdown,
  });

  const leagues = leaguesResponse?.data || [];

  if (item.hasDropdown && !isCollapsed) {
    return (
      <NavigationMenu>
        <NavigationMenuList>
          <NavigationMenuItem>
            <NavigationMenuTrigger
              className={cn(
                "w-full flex items-center px-2 py-2 text-sm font-medium rounded-md",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-gray-600 hover:bg-gray-50"
              )}
            >
              <Icon
                className={cn(
                  "h-5 w-5 flex-shrink-0 mr-3",
                  isActive ? "text-primary-foreground" : "text-gray-400"
                )}
              />
              {item.name}
            </NavigationMenuTrigger>
            <NavigationMenuContent>
              <div className="w-[200px] p-2">
                {leagues.map((league) => (
                  <Link key={league.id} href={`/leagues/${league.id}`}>
                    <a className="block px-4 py-2 text-sm rounded-md hover:bg-accent">
                      {league.name}
                    </a>
                  </Link>
                ))}
                <div className="border-t mt-2 pt-2">
                  <Link href="/leagues">
                    <a className="block px-4 py-2 text-sm rounded-md hover:bg-accent font-medium">
                      View All Leagues
                    </a>
                  </Link>
                </div>
              </div>
            </NavigationMenuContent>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>
    );
  }

  if (item.hasDropdown && isCollapsed) {
    return (
      <Link href={item.href}>
        <a
          className={cn(
            "flex items-center px-2 py-2 text-sm font-medium rounded-md",
            isActive
              ? "bg-primary text-primary-foreground"
              : "text-gray-600 hover:bg-gray-50"
          )}
          title={item.name}
        >
          <Icon
            className={cn(
              "h-5 w-5 mx-auto",
              isActive ? "text-primary-foreground" : "text-gray-400"
            )}
          />
        </a>
      </Link>
    );
  }

  return (
    <Link href={item.href}>
      <a
        className={cn(
          "flex items-center px-2 py-2 text-sm font-medium rounded-md",
          isActive
            ? "bg-primary text-primary-foreground"
            : "text-gray-600 hover:bg-gray-50"
        )}
        title={isCollapsed ? item.name : undefined}
      >
        <Icon
          className={cn(
            "h-5 w-5 flex-shrink-0",
            isActive ? "text-primary-foreground" : "text-gray-400",
            isCollapsed ? "mx-auto" : "mr-3"
          )}
        />
        {!isCollapsed && item.name}
      </a>
    </Link>
  );
});

NavigationItem.displayName = "NavigationItem";

const ErrorFallback = ({ error }: { error: Error }) => {
  return (
    <div className="p-4 text-sm text-red-500">
      Error loading content: {error.message}
    </div>
  );
};

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(() =>
    getStoredValue("sidebarCollapsed", false)
  );

  useEffect(() => {
    setStoredValue("sidebarCollapsed", isCollapsed);
  }, [isCollapsed]);

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
                <nav className="mt-8 flex-1 space-y-1 px-2">
                  {baseNavigation.map((item) => (
                    <NavigationItem
                      key={item.name}
                      item={item}
                      isActive={location === item.href}
                      isCollapsed={isCollapsed}
                    />
                  ))}
                </nav>
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      </div>

      <div className={cn("transition-all duration-300", isCollapsed ? "pl-16" : "pl-64")}>
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