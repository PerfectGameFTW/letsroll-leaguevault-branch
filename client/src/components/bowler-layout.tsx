import { FC, ReactNode } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Menu, LayoutDashboard, History, Trophy, Medal, UserCircle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  icon: typeof LayoutDashboard;
  label: string;
  href: string;
}

const navItems: NavItem[] = [
  {
    icon: LayoutDashboard,
    label: "Overview",
    href: "/bowler-dashboard"
  },
  {
    icon: History,
    label: "Payment History",
    href: "/payments"
  },
  {
    icon: Trophy,
    label: "My Scores",
    href: "/scores"
  },
  {
    icon: Medal,
    label: "League Standings",
    href: "/standings"
  },
  {
    icon: UserCircle,
    label: "Profile Settings",
    href: "/profile"
  }
];

interface BowlerLayoutProps {
  children: ReactNode;
  bowlerName: string;
  leagueName: string;
}

const SideNav = () => {
  const [location] = useLocation();

  return (
    <nav className="space-y-2">
      {navItems.map((item) => {
        const isActive = location === item.href;
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

export const BowlerLayout: FC<BowlerLayoutProps> = ({ children, bowlerName, leagueName }) => {
  const [location] = useLocation();

  return (
    <div className="flex min-h-screen">
      {/* Desktop Navigation */}
      <aside className="hidden lg:block w-64 border-r px-4 py-6">
        <div className="mb-6">
          <h2 className="text-lg font-semibold">{bowlerName}</h2>
          <p className="text-sm text-muted-foreground">{leagueName}</p>
        </div>
        <SideNav />
      </aside>

      {/* Mobile Navigation */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t">
        <nav className="flex justify-around items-center h-16">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <div
                  role="button"
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex flex-col items-center gap-1.5 p-2 transition-colors duration-200",
                    isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  <span className="text-xs font-medium">{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Main Content */}
      <main className="flex-1 px-4 py-6 lg:py-6 pb-20 lg:pb-6">
        <div className="max-w-7xl mx-auto">
          <div className="lg:hidden mb-6">
            <h2 className="text-lg font-semibold">{bowlerName}</h2>
            <p className="text-sm text-muted-foreground">{leagueName}</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
};