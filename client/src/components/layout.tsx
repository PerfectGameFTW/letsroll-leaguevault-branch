import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Home, Users, CreditCard, Trophy } from "lucide-react";

const navigation = [
  { name: "Dashboard", href: "/", icon: Home },
  { name: "Leagues", href: "/leagues", icon: Trophy },
  { name: "Bowlers", href: "/bowlers", icon: Users },
  { name: "Payments", href: "/payments", icon: CreditCard },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex min-h-screen">
        {/* Sidebar */}
        <div className="w-64 flex-shrink-0 bg-white border-r">
          <div className="flex flex-col flex-1">
            <div className="flex-1 flex flex-col pt-5 pb-4">
              <div className="flex items-center flex-shrink-0 px-4">
                <h1 className="text-xl font-bold text-gray-900">
                  League Manager
                </h1>
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
                      >
                        <Icon
                          className={cn(
                            "mr-3 h-5 w-5",
                            location === item.href
                              ? "text-primary-foreground"
                              : "text-gray-400"
                          )}
                        />
                        {item.name}
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