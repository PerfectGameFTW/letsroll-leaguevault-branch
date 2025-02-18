import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Home, Users, CreditCard, ChevronLeft, ChevronRight, Trophy, ClipboardPlus, LayoutDashboard } from "lucide-react";
import { useState, useEffect, Suspense } from "react";
import { Button } from "@/components/ui/button";
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
    href: "/reports",
    hasDropdown: true,
    subItems: [
      { icon: ClipboardPlus, label: "League Reports", href: "/reports" }
    ]
  },
  {
    icon: LayoutDashboard,
    label: "Bowler Dashboard",
    href: "/bowler-dashboard"
  }
];

const SideNav = () => {
  const [location] = useLocation();

  return (
    <nav className="space-y-2">
      {navItems.map((item) => {
        const isActive = location === item.href;
        if (item.hasDropdown) {
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
                    <div className="w-[200px] p-2">
                      {item.subItems ? (
                        // Render sub-items for Reports
                        item.subItems.map((subItem) => (
                          <Link key={subItem.href} href={subItem.href}>
                            <button className="flex w-full items-center px-4 py-2 text-sm rounded-md hover:bg-accent">
                              <subItem.icon className="h-4 w-4 mr-2" />
                              {subItem.label}
                            </button>
                          </Link>
                        ))
                      ) : (
                        // Render leagues dropdown
                        <>
                          {item.label === "Leagues" && (
                            <LeaguesDropdownContent />
                          )}
                        </>
                      )}
                    </div>
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
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all hover:bg-accent",
                isActive && "bg-accent"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
              {isActive && <ChevronRight className="ml-auto h-4 w-4" />}
            </button>
          </Link>
        );
      })}
    </nav>
  );
};

const LeaguesDropdownContent = () => {
  const { data: leaguesResponse } = useQuery<{ data: League[] }>({
    queryKey: ["/api/leagues"],
  });

  const leagues = leaguesResponse?.data || [];

  return (
    <>
      {leagues.map((league) => (
        <Link key={league.id} href={`/leagues/${league.id}`}>
          <button className="block w-full text-left px-4 py-2 text-sm rounded-md hover:bg-accent">
            {league.name}
          </button>
        </Link>
      ))}
      <div className="border-t mt-2 pt-2">
        <Link href="/leagues">
          <button className="block w-full text-left px-4 py-2 text-sm rounded-md hover:bg-accent font-medium">
            View All Leagues
          </button>
        </Link>
      </div>
    </>
  );
};

export function Layout({ children }: { children: React.ReactNode }) {
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
                  <SideNav />
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

const ErrorFallback = ({ error }: { error: Error }) => {
  return (
    <div className="p-4 text-sm text-red-500">
      Error loading content: {error.message}
    </div>
  );
};