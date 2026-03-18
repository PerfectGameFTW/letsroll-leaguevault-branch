import { FC, ReactNode } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Menu, LayoutDashboard, History, UserCircle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Organization, User, ApiResponse } from "@shared/schema";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";


interface NavItem {
  icon: typeof LayoutDashboard;
  label: string;
  href: string;
  baseHref: string;
}

function buildNavItems(currentLeagueId?: number): NavItem[] {
  const paymentHistoryHref = currentLeagueId
    ? `/payment-history?leagueId=${currentLeagueId}`
    : '/payment-history';
  return [
    {
      icon: LayoutDashboard,
      label: "Overview",
      href: "/bowler-dashboard",
      baseHref: "/bowler-dashboard",
    },
    {
      icon: History,
      label: "Payment History",
      href: paymentHistoryHref,
      baseHref: "/payment-history",
    },
    {
      icon: UserCircle,
      label: "Profile Settings",
      href: "/profile",
      baseHref: "/profile",
    },
  ];
}

const SideNav = ({ currentLeagueId }: { currentLeagueId?: number }) => {
  const [location] = useLocation();
  const navItems = buildNavItems(currentLeagueId);

  return (
    <nav className="space-y-2">
      {navItems.map((item) => {
        const isActive = location === item.baseHref || location.startsWith(item.baseHref + '?');
        return (
          <Link key={item.baseHref} href={item.href}>
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

export const BowlerLayout: FC<BowlerLayoutProps> = ({ children, bowlerName, leagueName, currentLeagueId }) => {
  const [location] = useLocation();
  const mobileNavItems = buildNavItems(currentLeagueId);
  
  // Fetch current user to get organization ID
  const { data: currentUserResponse } = useQuery<ApiResponse<User>>({
    queryKey: ["/api/user"],
    staleTime: 1000 * 60 * 5,
  });
  
  // Fetch Perfect Game organization for guaranteed logo
  const { data: perfectGameOrgResponse } = useQuery<ApiResponse<Organization>>({
    queryKey: ["/api/organizations/slug/perfect-game"],
    staleTime: 1000 * 60 * 60, // Cache for an hour
    enabled: true
  });
  
  const userOrgId = currentUserResponse?.data?.organizationId;
  const { data: userOrgResponse } = useQuery<ApiResponse<Organization>>({
    queryKey: ["/api/organizations", userOrgId],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/${userOrgId}`, {
        credentials: "include",
        headers: { "Accept": "application/json" }
      });
      if (!res.ok) throw new Error(`Failed to fetch organization: ${res.status}`);
      return res.json();
    },
    staleTime: 1000 * 60 * 60,
    enabled: !!userOrgId,
    retry: false,
  });
  
  // Determine which logo to use
  const orgLogo = userOrgResponse?.data?.logo || perfectGameOrgResponse?.data?.logo;
  const orgName = userOrgResponse?.data?.name || perfectGameOrgResponse?.data?.name || "Organization";

  return (
    <div className="flex min-h-screen">
      {/* Desktop Navigation */}
      <aside className="hidden lg:block w-64 border-r px-4 py-6">
        <div className="mb-4">
          <Link href="/">
            {orgLogo && (
              <img 
                src={orgLogo}
                alt={`${orgName} Logo`}
                className="h-14 md:h-14 lg:h-16 w-auto mb-4 object-contain" 
              />
            )}
            {!orgLogo && (
              <div className="h-14 md:h-14 lg:h-16 mb-4" />
            )}
          </Link>
          <h2 className="text-lg font-semibold">{bowlerName}</h2>
          <p className="text-sm text-muted-foreground">{leagueName}</p>
        </div>
        <SideNav currentLeagueId={currentLeagueId} />
      </aside>

      {/* Mobile Navigation */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="flex items-center justify-between h-14 px-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10"
              >
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle navigation menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72 z-[200] mt-1 p-2">
              {mobileNavItems.map((item) => {
                const isActive = location === item.baseHref || location.startsWith(item.baseHref + '?');
                return (
                  <Link key={item.baseHref} href={item.href}>
                    <DropdownMenuItem
                      className={cn(
                        "flex items-center gap-3 cursor-pointer transition-colors text-base py-3 px-4 rounded-md",
                        isActive && "bg-accent"
                      )}
                    >
                      <item.icon className="h-5 w-5 shrink-0" />
                      <span>{item.label}</span>
                      {isActive && <ChevronRight className="ml-auto h-5 w-5" />}
                    </DropdownMenuItem>
                  </Link>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <Link href="/">
            {orgLogo ? (
              <img 
                src={orgLogo}
                alt={`${orgName} Logo`}
                className="h-12 w-auto object-contain" 
              />
            ) : (
              <div className="h-12" />
            )}
          </Link>

          {/* Empty div to maintain center alignment */}
          <div className="w-8" />
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 px-4 py-6 lg:py-6">
        <div className="max-w-7xl mx-auto mt-14 lg:mt-0">
          {children}
        </div>
      </main>
    </div>
  );
};

interface BowlerLayoutProps {
  children: ReactNode;
  bowlerName: string;
  leagueName: string;
  currentLeagueId?: number;
}