import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Building2, Plus, Trash2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Define types
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

function LoadingState() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

function ErrorState({ error }: { error: Error }) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Error</AlertTitle>
      <AlertDescription>
        {error.message || "An error occurred while loading organization users."}
      </AlertDescription>
    </Alert>
  );
}

// Component for organization admins to manage only their organization
export function OrganizationUsersOnly() {
  const [orgAdminStatuses, setOrgAdminStatuses] = useState<Record<number, boolean>>({});
  const [addUserDialogOpen, setAddUserDialogOpen] = useState(false);
  const [userToAdd, setUserToAdd] = useState<number | null>(null);
  const { toast } = useToast();
  
  // Query to fetch the current user
  const { data: userResponse } = useQuery<{ success: boolean; data: User }>({
    queryKey: ['/api/user'],
  });
  
  const currentUser = userResponse?.data;
  const organizationId = currentUser?.organizationId;
  
  // Query to fetch all users for adding to organization
  const { data: allUsersResponse, isLoading: allUsersLoading } = useQuery<{ success: boolean; data: User[] }>({
    queryKey: ['/api/admin/users'],
    enabled: true,
  });
  
  // Query to fetch organization users
  const { data: orgUsersResponse, isLoading: orgUsersLoading, error: orgUsersError } = useQuery<{ success: boolean; data: User[] }>({
    queryKey: ['/api/org-admin/users', organizationId],
    enabled: !!organizationId,
  });

  // Mutation to update organization admin status
  const updateOrgAdminStatus = useMutation({
    mutationFn: async ({ userId, isOrganizationAdmin }: { userId: number; isOrganizationAdmin: boolean }) => {
      return apiRequest(`/api/org-admin/users/${userId}/admin-status`, 'PATCH', { isOrganizationAdmin });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/org-admin/users', organizationId] });
      toast({
        title: 'Success',
        description: 'Organization admin status updated successfully.',
        variant: 'default',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update organization admin status.',
        variant: 'destructive',
      });
    },
  });
  
  // Mutation to add user to organization
  const addUserToOrg = useMutation({
    mutationFn: async ({ userId, isOrganizationAdmin }: { userId: number; isOrganizationAdmin: boolean }) => {
      return apiRequest(`/api/org-admin/users/${userId}/add`, 'POST', { 
        organizationId: organizationId,
        isOrganizationAdmin
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/org-admin/users', organizationId] });
      toast({
        title: 'Success',
        description: 'User added to organization successfully.',
        variant: 'default',
      });
      setAddUserDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to add user to organization.',
        variant: 'destructive',
      });
    },
  });
  
  // Mutation to remove user from organization
  const removeUserFromOrg = useMutation({
    mutationFn: async (userId: number) => {
      return apiRequest(`/api/org-admin/users/${userId}/remove`, 'DELETE');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/org-admin/users', organizationId] });
      toast({
        title: 'Success',
        description: 'User removed from organization successfully.',
        variant: 'default',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to remove user from organization.',
        variant: 'destructive',
      });
    },
  });
  
  // Initialize organization admin statuses when data is loaded
  useEffect(() => {
    if (orgUsersResponse?.data) {
      const initialStatuses: Record<number, boolean> = {};
      orgUsersResponse.data.forEach(user => {
        initialStatuses[user.id] = user.isOrganizationAdmin;
      });
      setOrgAdminStatuses(initialStatuses);
    }
  }, [orgUsersResponse?.data]);
  
  // Filter users that are not in an organization
  const availableUsers = allUsersResponse?.data?.filter(user => !user.organizationId) || [];
  
  // Handle toggle change for organization admin status
  const handleOrgAdminToggle = (userId: number, newStatus: boolean) => {
    // Update local state immediately for responsive UI
    setOrgAdminStatuses(prev => ({
      ...prev,
      [userId]: newStatus
    }));
    
    // Make API call to update organization admin status
    updateOrgAdminStatus.mutate({ userId, isOrganizationAdmin: newStatus });
  };
  
  // Handle adding user to organization
  const handleAddUser = (makeAdmin: boolean = false) => {
    if (userToAdd) {
      addUserToOrg.mutate({ userId: userToAdd, isOrganizationAdmin: makeAdmin });
    }
  };
  
  if (!organizationId) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        You are not associated with any organization. Contact a system administrator.
      </div>
    );
  }
  
  if (orgUsersLoading) return <LoadingState />;
  if (orgUsersError) return <ErrorState error={orgUsersError as Error} />;
  
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={addUserDialogOpen} onOpenChange={setAddUserDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add User to Organization</DialogTitle>
              <DialogDescription>
                Select a user to add to this organization
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Select
                value={userToAdd?.toString() || ""}
                onValueChange={(value) => setUserToAdd(parseInt(value, 10))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select user" />
                </SelectTrigger>
                <SelectContent>
                  {availableUsers.map((user) => (
                    <SelectItem key={user.id} value={user.id.toString()}>
                      {user.name || user.email}
                    </SelectItem>
                  ))}
                  {availableUsers.length === 0 && (
                    <SelectItem value="none" disabled>
                      No available users
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddUserDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => handleAddUser(false)}
                disabled={!userToAdd || addUserToOrg.isPending}
              >
                Add as Member
              </Button>
              <Button 
                onClick={() => handleAddUser(true)} 
                disabled={!userToAdd || addUserToOrg.isPending}
                variant="default"
              >
                Add as Admin
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      
      <table className="w-full">
        <thead>
          <tr className="text-left">
            <th className="pb-2">ID</th>
            <th className="pb-2">Name</th>
            <th className="pb-2">Email</th>
            <th className="pb-2">Admin Status</th>
            <th className="pb-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {orgUsersResponse?.data?.map((user) => (
            <tr key={user.id} className="border-t">
              <td className="py-2">{user.id}</td>
              <td className="py-2">{user.name || 'N/A'}</td>
              <td className="py-2">{user.email}</td>
              <td className="py-2">
                <div className="flex items-center space-x-2">
                  <Switch 
                    id={`org-admin-status-${user.id}`}
                    checked={orgAdminStatuses[user.id] || false}
                    onCheckedChange={(checked) => handleOrgAdminToggle(user.id, checked)}
                    disabled={updateOrgAdminStatus.isPending}
                  />
                  <span className="text-sm">
                    {orgAdminStatuses[user.id] ? 'Admin' : 'Member'}
                  </span>
                </div>
              </td>
              <td className="py-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => removeUserFromOrg.mutate(user.id)}
                  disabled={removeUserFromOrg.isPending}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Remove
                </Button>
              </td>
            </tr>
          ))}
          {!orgUsersResponse?.data?.length && (
            <tr>
              <td colSpan={5} className="py-3 text-center text-muted-foreground">
                No users found in this organization
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}