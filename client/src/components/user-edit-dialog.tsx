'use client';

import { useState } from 'react';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface User {
  id: number;
  email: string;
  name: string | null;
  isAdmin: boolean;
  isOrganizationAdmin: boolean;
  organizationId: number | null;
  bowlerId: number | null;
  createdAt: string;
}

interface UserEditDialogProps {
  user: User;
  onUpdate: (updatedUser: User) => void;
  currentUserIsAdmin: boolean;
}

export function UserEditDialog({ user, onUpdate, currentUserIsAdmin }: UserEditDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(user.name || '');
  const [email, setEmail] = useState(user.email);
  const [isAdmin, setIsAdmin] = useState(user.isAdmin);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const updateData: Record<string, any> = {};
      
      if (name !== user.name) updateData.name = name;
      if (email !== user.email) updateData.email = email;
      if (isAdmin !== user.isAdmin && currentUserIsAdmin) updateData.isAdmin = isAdmin;

      // Only send the request if there are changes
      if (Object.keys(updateData).length === 0) {
        setOpen(false);
        return;
      }

      const response = await apiRequest(`/api/user-update/profile/${user.id}`, 'PATCH', updateData);
      
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to update user');
      }

      toast({
        title: "User updated",
        description: "User information has been updated successfully.",
      });

      // Call the onUpdate callback with the updated user
      onUpdate(response.data);
      setOpen(false);
    } catch (error) {
      console.error('Error updating user:', error);
      toast({
        title: "Update failed",
        description: error instanceof Error ? error.message : 'Failed to update user',
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <span className="text-base font-normal text-foreground hover:underline cursor-pointer">
          {user.name || 'N/A'}
        </span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>
            Update user information. Click save when you're done.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="User name"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
              />
            </div>
            {currentUserIsAdmin && (
              <div className="flex items-center space-x-2">
                <Switch
                  id="admin-status"
                  checked={isAdmin}
                  onCheckedChange={setIsAdmin}
                />
                <Label htmlFor="admin-status">System Admin</Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => setOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button 
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}