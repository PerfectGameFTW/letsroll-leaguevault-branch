import { UserCircle, LogOut, Upload, User as UserIcon, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useRef, ChangeEvent } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

interface UserProfileMenuProps {
  user: {
    id: number;
    name: string | null;
    email: string;
    isAdmin: boolean;
    isOrganizationAdmin: boolean;
    avatar?: string | null;
  };
  showName?: boolean;
}

export function UserProfileMenu({ user, showName = false }: UserProfileMenuProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', 'POST', {});
      queryClient.cancelQueries();
      window.location.href = '/login';
      queryClient.clear();
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

  // Get initials for the avatar fallback
  const getInitials = () => {
    if (user.name) {
      const nameParts = user.name.split(' ');
      if (nameParts.length > 1) {
        return `${nameParts[0][0]}${nameParts[1][0]}`.toUpperCase();
      }
      return user.name[0].toUpperCase();
    }
    return user.email[0].toUpperCase();
  };

  const triggerFileInput = () => {
    setIsMenuOpen(false);
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file size (< 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast({
        variant: "destructive",
        title: "File too large",
        description: "Avatar image must be less than 2MB",
      });
      return;
    }

    // Check file type
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
      toast({
        variant: "destructive",
        title: "Invalid file type",
        description: "Please upload a JPG, PNG, GIF, or WebP image",
      });
      return;
    }

    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append('avatar', file);

      const response = await fetch('/api/user/avatar', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const data = await response.json();
      
      // Invalidate user query to refresh data
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });

      toast({
        title: "Avatar updated",
        description: "Your profile picture has been updated successfully.",
      });
    } catch (error) {
      console.error('Avatar upload failed:', error);
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: "There was a problem uploading your avatar. Please try again.",
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const openProfileDialog = () => {
    setIsMenuOpen(false);
    setIsProfileDialogOpen(true);
  };

  return (
    <>
      <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="ghost" 
            size={showName ? "sm" : "icon"}
            className={showName ? "flex items-center gap-2 px-2" : "rounded-full"}
          >
            <Avatar className="h-10 w-10 flex-shrink-0 border border-muted">
              {user.avatar ? (
                <AvatarImage src={user.avatar} alt={user.name || user.email} />
              ) : null}
              <AvatarFallback className="text-base">{getInitials()}</AvatarFallback>
            </Avatar>
            {showName && (
              <span className="ml-2 text-sm font-medium max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap">
                {user.name || user.email}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[220px]">
          <div className="px-3 py-2 text-sm font-medium">
            <div className="truncate font-medium">{user.name}</div>
            <div className="truncate text-xs text-muted-foreground">{user.email}</div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="cursor-pointer" onClick={openProfileDialog}>
            <div className="flex items-center gap-2">
              <UserIcon className="h-4 w-4" />
              <span>Profile</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem className="cursor-pointer" onClick={triggerFileInput}>
            <div className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              <span>{isUploading ? "Uploading..." : "Change Avatar"}</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="cursor-pointer" onClick={handleLogout}>
            <div className="flex items-center gap-2 text-destructive">
              <LogOut className="h-4 w-4" />
              <span>Logout</span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Hidden file input for avatar upload */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        accept="image/jpeg,image/png,image/gif,image/webp"
        onChange={handleFileChange}
      />

      {/* Profile Dialog */}
      <Dialog open={isProfileDialogOpen} onOpenChange={setIsProfileDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>User Profile</DialogTitle>
          </DialogHeader>
          <div className="py-4 flex flex-col items-center space-y-4">
            <Avatar className="h-24 w-24 border border-muted">
              {user.avatar ? (
                <AvatarImage src={user.avatar} alt={user.name || user.email} />
              ) : null}
              <AvatarFallback className="text-lg">{getInitials()}</AvatarFallback>
            </Avatar>
            <div className="text-center">
              <h3 className="font-medium text-lg">{user.name}</h3>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
            <div className="flex gap-4">
              <Button variant="outline" size="sm" onClick={triggerFileInput}>
                <Upload className="h-4 w-4 mr-2" />
                {isUploading ? "Uploading..." : "Change Avatar"}
              </Button>
            </div>
            <Separator />
            <div className="w-full space-y-2">
              <Label>Roles</Label>
              <div className="text-sm">
                {user.isAdmin && <div className="py-1">System Administrator</div>}
                {user.isOrganizationAdmin && <div className="py-1">Organization Administrator</div>}
                {!user.isAdmin && !user.isOrganizationAdmin && <div className="py-1">Standard User</div>}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}