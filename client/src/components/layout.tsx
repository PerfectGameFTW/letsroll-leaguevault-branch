import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Home, Users, CreditCard, Trophy, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";

const navigation = [
  { name: "Dashboard", href: "/", icon: Home },
  { name: "Leagues", href: "/leagues", icon: Trophy },
  { name: "Bowlers", href: "/bowlers", icon: Users },
  { name: "Payments", href: "/payments", icon: CreditCard },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(false);

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
                {navigation.map((item) => {
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
          <main className="py-6 px-4 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}