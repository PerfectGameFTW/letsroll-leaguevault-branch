import { UserCircle, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

interface UserProfileMenuProps {
  user: {
    id: number;
    name: string | null;
    email: string;
    isAdmin: boolean;
    isOrganizationAdmin: boolean;
  };
}

export function UserProfileMenu({ user }: UserProfileMenuProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const handleLogout = async () => {
    try {
      await apiRequest('POST', '/api/auth/logout', {});
      queryClient.clear(); // Clear all cached data
      window.location.href = '/login'; // Redirect to login page
      toast({
        title: "Logged out",
        description: "You have been successfully logged out.",
      });
    } catch (error) {
      console.error('Logout failed:', error);
      toast({
        variant: "destructive",
        title: "Logout failed",
        description: "There was a problem logging out. Please try again.",
      });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="flex items-center gap-2">
          <UserCircle className="h-4 w-4" />
          <span className="max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap">
            {user.name || user.email}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[200px]">
        <div className="px-2 py-1.5 text-sm font-medium">
          <div className="truncate">{user.name}</div>
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
        </div>
        <DropdownMenuItem className="cursor-pointer" onClick={handleLogout}>
          <div className="flex items-center gap-2 text-destructive">
            <LogOut className="h-4 w-4" />
            <span>Logout</span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}