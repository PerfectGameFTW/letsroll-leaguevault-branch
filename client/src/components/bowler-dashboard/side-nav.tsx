import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  History,
  UserCircle,
  ChevronRight
} from "lucide-react";

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
    icon: UserCircle,
    label: "Profile Settings",
    href: "/profile"
  }
];

const SideNav = () => {
  const [location] = useLocation();

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

export default SideNav;
