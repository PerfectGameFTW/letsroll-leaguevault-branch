import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Home, Users, CreditCard, Trophy, ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useEffect } from "react";
import { Button } from "./ui/button";
import { useQuery } from "@tanstack/react-query";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import type { League } from "@shared/schema";

const baseNavigation = [
  { name: "Dashboard", href: "/", icon: Home },
  { name: "Bowlers", href: "/bowlers", icon: Users },
  { name: "Payments", href: "/payments", icon: CreditCard },
];

// Safe localStorage access function
const safeGetLocalStorage = (key: string, defaultValue: any) => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : defaultValue;
    }
  } catch (error) {
    console.warn('localStorage access error:', error);
  }
  return defaultValue;
};

const safeSetLocalStorage = (key: string, value: any) => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch (error) {
    console.warn('localStorage access error:', error);
  }
};

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(() =>
    safeGetLocalStorage("sidebarCollapsed", false)
  );

  const { data: leaguesResponse } = useQuery<{ success: true, data: League[] }>({
    queryKey: ["/api/leagues"],
  });

  const leagues = leaguesResponse?.data || [];

  useEffect(() => {
    safeSetLocalStorage("sidebarCollapsed", isCollapsed);
  }, [isCollapsed]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex min-h-screen">
        {/* Sidebar */}
        <div
          className={cn(
            "flex-shrink-0 bg-white border-r transition-all duration-300",
            isCollapsed ? "w-16" : "w-64"
          )}
        >
          <div className="flex flex-col flex-1">
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
              <nav className="mt-8 flex-1 space-y-1 px-2">
                {/* Dashboard */}
                <Link href="/">
                  <span
                    className={cn(
                      "group flex items-center px-2 py-2 text-sm font-medium rounded-md cursor-pointer",
                      location === "/"
                        ? "bg-primary text-primary-foreground"
                        : "text-gray-600 hover:bg-gray-50"
                    )}
                    title={isCollapsed ? "Dashboard" : undefined}
                  >
                    <Home
                      className={cn(
                        "h-5 w-5 flex-shrink-0",
                        location === "/"
                          ? "text-primary-foreground"
                          : "text-gray-400",
                        isCollapsed ? "mx-auto" : "mr-3"
                      )}
                    />
                    {!isCollapsed && "Dashboard"}
                  </span>
                </Link>

                {/* Leagues Navigation Menu */}
                {!isCollapsed && (
                  <NavigationMenu orientation="vertical" className="w-full">
                    <NavigationMenuList className="flex-col items-start">
                      <NavigationMenuItem className="w-full">
                        <NavigationMenuTrigger className={cn(
                          "w-full justify-start group flex items-center px-2 py-2 text-sm font-medium rounded-md",
                          location.startsWith('/leagues') || (Array.isArray(leagues) && leagues.some(league => location.startsWith(`/teams/${league.id}`)))
                            ? "bg-primary text-primary-foreground"
                            : "text-gray-600 hover:bg-gray-50"
                        )}>
                          <Trophy className={cn(
                            "h-5 w-5 flex-shrink-0 mr-3",
                            location.startsWith('/leagues') || (Array.isArray(leagues) && leagues.some(league => location.startsWith(`/teams/${league.id}`)))
                              ? "text-primary-foreground"
                              : "text-gray-400"
                          )} />
                          Leagues
                        </NavigationMenuTrigger>
                        <NavigationMenuContent>
                          <div className="w-48 p-2">
                            <Link href="/leagues" className="block px-2 py-1 text-sm rounded hover:bg-accent">
                              All Leagues
                            </Link>
                            <div className="my-1 border-t" />
                            {Array.isArray(leagues) && leagues.map((league) => (
                              <Link
                                key={league.id}
                                href={`/leagues/${league.id}/teams`}
                                className="block px-2 py-1 text-sm rounded hover:bg-accent"
                              >
                                {league.name}
                              </Link>
                            ))}
                          </div>
                        </NavigationMenuContent>
                      </NavigationMenuItem>
                    </NavigationMenuList>
                  </NavigationMenu>
                )}

                {/* Collapsed League Icon */}
                {isCollapsed && (
                  <Link href="/leagues">
                    <span
                      className={cn(
                        "group flex items-center px-2 py-2 text-sm font-medium rounded-md cursor-pointer",
                        location.startsWith('/leagues') || (Array.isArray(leagues) && leagues.some(league => location.startsWith(`/teams/${league.id}`)))
                          ? "bg-primary text-primary-foreground"
                          : "text-gray-600 hover:bg-gray-50"
                      )}
                      title="Leagues"
                    >
                      <Trophy
                        className={cn(
                          "h-5 w-5 flex-shrink-0",
                          location.startsWith('/leagues') || (Array.isArray(leagues) && leagues.some(league => location.startsWith(`/teams/${league.id}`)))
                            ? "text-primary-foreground"
                            : "text-gray-400",
                          "mx-auto"
                        )}
                      />
                    </span>
                  </Link>
                )}

                {/* Rest of the navigation items */}
                {baseNavigation.slice(1).map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link key={item.name} href={item.href}>
                      <span
                        className={cn(
                          "group flex items-center px-2 py-2 text-sm font-medium rounded-md cursor-pointer",
                          location === item.href
                            ? "bg-primary text-primary-foreground"
                            : "text-gray-600 hover:bg-gray-50"
                        )}
                        title={isCollapsed ? item.name : undefined}
                      >
                        <Icon
                          className={cn(
                            "h-5 w-5 flex-shrink-0",
                            location === item.href
                              ? "text-primary-foreground"
                              : "text-gray-400",
                            isCollapsed ? "mx-auto" : "mr-3"
                          )}
                        />
                        {!isCollapsed && item.name}
                      </span>
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-auto">
          <main className="py-6 px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto">{children}</main>
        </div>
      </div>
    </div>
  );
}