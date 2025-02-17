import { FC, ReactNode, useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Menu, LayoutDashboard, History, Trophy, Medal, Gavel, UserCircle, ChevronRight } from "lucide-react";
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
    href: "/payment-history"
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
    icon: Gavel,
    label: "League Rules",
    href: "/league-rules"
  },
  {
    icon: UserCircle,
    label: "Profile Settings",
    href: "/profile"
  }
];

const SideNav = () => {
  const [location] = useLocation();

  // Debug output
  useEffect(() => {
    console.log('Navigation Items:', navItems.map(item => item.label));
  }, []);

  return (
    <nav className="space-y-2">
      {navItems.map((item) => {
        const isActive = location === item.href;
        return (
          <Link key={item.href} href={item.href}>
            <a
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all hover:bg-accent",
                isActive && "bg-accent"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
              {isActive && <ChevronRight className="ml-auto h-4 w-4" />}
            </a>
          </Link>
        );
      })}
    </nav>
  );
};

interface BowlerLayoutProps {
  children: ReactNode;
  bowlerName?: string;
  leagueName?: string;
}

export const BowlerLayout: FC<BowlerLayoutProps> = ({ children, bowlerName, leagueName }) => {
  const [open, setOpen] = useState(false);

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
      <div className="lg:hidden fixed top-4 left-4 z-50">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon">
              <Menu className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64">
            <div className="mb-6">
              <h2 className="text-lg font-semibold">{bowlerName}</h2>
              <p className="text-sm text-muted-foreground">{leagueName}</p>
            </div>
            <SideNav />
          </SheetContent>
        </Sheet>
      </div>

      {/* Main Content */}
      <main className="flex-1 px-4 py-6">
        {children}
      </main>
    </div>
  );
};