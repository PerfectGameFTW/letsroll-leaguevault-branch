import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { UserEditDialog } from '@/components/user-edit-dialog';
import { AlertCircle, Users, Plus, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

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

interface Organization {
  id: number;
  name: string;
  description: string | null;
  slug: string;
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-[300px] w-full rounded-md" />
    </div>
  );
}

function ErrorState({ error }: { error: Error }) {
  return (
    <Alert variant="destructive" className="my-4">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Error</AlertTitle>
      <AlertDescription>
        {error.message || 'Unable to load user management. Please try again later.'}
      </AlertDescription>
    </Alert>
  );
}

export function OrganizationUserManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [orgAdminStatuses, setOrgAdminStatuses] = useState<Record<number, boolean>>({});
  const [addUserDialogOpen, setAddUserDialogOpen] = useState(false);
  const [userToAdd, setUserToAdd] = useState<number | null>(null);
  
  const { data: userResponse } = useQuery<{ success: boolean; data: User }>({
    queryKey: ['/api/user'],
  });
  
  const currentUser = userResponse?.data;
  const organizationId = currentUser?.organizationId;
  
  const [selectedOrganization, setSelectedOrganization] = useState<number | null>(null);
  
  useEffect(() => {
    if (organizationId) {
      setSelectedOrganization(organizationId);
    }
  }, [organizationId]);
  
  const { data: orgsResponse, isLoading: orgsLoading, error: orgsError } = useQuery<{ success: boolean; data: Organization[] }>({
    queryKey: ['/api/organizations'],
    enabled: true,
    select: (data) => {
      if (currentUser?.isAdmin && currentUser?.organizationId) {
        return {
          success: data.success,
          data: data.data.filter(org => org.id === currentUser.organizationId)
        };
      }
      return data;
    }
  });

  const { data: allUsersResponse, isLoading: allUsersLoading } = useQuery<{ success: boolean; data: User[] }>({
    queryKey: ['/api/admin/users'],
    enabled: true,
  });
  
  const { data: orgUsersResponse, isLoading: orgUsersLoading, error: orgUsersError } = useQuery<{ success: boolean; data: User[] }>({
    queryKey: ['/api/org-admin/users', selectedOrganization],
    queryFn: async ({ queryKey }) => {
      const orgId = queryKey[1];
      if (!orgId) throw new Error("Organization ID is required");
      
      const response = await fetch(`/api/org-admin/users?organizationId=${orgId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch organization users: ${response.statusText}`);
      }
      
      return response.json();
    },
    enabled: !!selectedOrganization,
  });
  
  const updateOrgAdminStatus = useMutation({
    mutationFn: async ({ userId, isOrganizationAdmin }: { userId: number; isOrganizationAdmin: boolean }) => {
      return apiRequest(`/api/org-admin/users/${userId}/admin-status`, 'PATCH', { isOrganizationAdmin });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/org-admin/users', selectedOrganization] });
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
  
  const addUserToOrg = useMutation({
    mutationFn: async ({ userId, isOrganizationAdmin }: { userId: number; isOrganizationAdmin: boolean }) => {
      return apiRequest(`/api/org-admin/users/${userId}/add`, 'POST', { 
        organizationId: selectedOrganization,
        isOrganizationAdmin
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/org-admin/users', selectedOrganization] });
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
  
  const removeUserFromOrg = useMutation({
    mutationFn: async (userId: number) => {
      return apiRequest(`/api/org-admin/users/${userId}/remove`, 'DELETE');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/org-admin/users', selectedOrganization] });
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
  
  useEffect(() => {
    if (orgUsersResponse?.data) {
      const initialStatuses: Record<number, boolean> = {};
      orgUsersResponse.data.forEach(user => {
        initialStatuses[user.id] = user.isOrganizationAdmin;
      });
      setOrgAdminStatuses(initialStatuses);
    }
  }, [orgUsersResponse?.data]);
  
  const availableUsers = allUsersResponse?.data?.filter(user => !user.organizationId) || [];
  
  const handleOrgAdminToggle = (userId: number, newStatus: boolean) => {
    setOrgAdminStatuses(prev => ({
      ...prev,
      [userId]: newStatus
    }));
    
    updateOrgAdminStatus.mutate({ userId, isOrganizationAdmin: newStatus });
  };
  
  const handleAddUser = (makeAdmin: boolean = false) => {
    if (userToAdd) {
      addUserToOrg.mutate({ userId: userToAdd, isOrganizationAdmin: makeAdmin });
    }
  };
  
  if (orgsLoading) return <LoadingState />;
  if (orgsError) return <ErrorState error={orgsError as Error} />;
  
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              <span>Users</span>
            </CardTitle>
            
            <div className="flex items-center gap-4">
              {selectedOrganization && (
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
              )}
              
              {currentUser?.isAdmin && !currentUser?.organizationId && (
                <Select
                  value={selectedOrganization?.toString() || ""}
                  onValueChange={(value) => setSelectedOrganization(parseInt(value, 10))}
                >
                  <SelectTrigger className="w-[250px]">
                    <SelectValue placeholder="Select an organization" />
                  </SelectTrigger>
                  <SelectContent>
                    {orgsResponse?.data && orgsResponse.data.length > 0 ? (
                      orgsResponse.data.map((org) => (
                        <SelectItem key={org.id} value={org.id.toString()}>
                          {org.name}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="none" disabled>
                        No organizations available
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

        </CardHeader>
        <CardContent>
          {!selectedOrganization ? (
            <div className="text-center py-10 text-muted-foreground">
              {currentUser?.isAdmin && !currentUser?.organizationId 
                ? "Please select an organization to manage its users" 
                : "Loading organization data..."}
            </div>
          ) : orgUsersLoading ? (
            <div className="pt-6">
              <LoadingState />
            </div>
          ) : orgUsersError ? (
            <div className="pt-6">
              <ErrorState error={orgUsersError as Error} />
            </div>
          ) : (
            <div className="space-y-4 pt-6">
              
              <table className="w-full">
                <thead>
                  <tr className="text-left">
                    <th className="pb-2">Name</th>
                    <th className="pb-2">Email</th>
                    <th className="pb-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orgUsersResponse?.data?.map((user) => (
                    <tr key={user.id} className="border-t">
                      <td className="py-2">
                        <UserEditDialog 
                          user={user} 
                          onUpdate={(updatedUser) => {
                            const allUsers = queryClient.getQueryData<{success: boolean, data: User[]}>(['/api/admin/users']);
                            if (allUsers) {
                              const updatedUsers = allUsers.data.map((u: User) => 
                                u.id === updatedUser.id ? updatedUser : u
                              );
                              queryClient.setQueryData(['/api/admin/users'], {
                                success: true,
                                data: updatedUsers
                              });
                            }
                          }}
                          currentUserIsAdmin={!!currentUser?.isAdmin}
                        />
                      </td>
                      <td className="py-2">{user.email}</td>
                      <td className="py-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeUserFromOrg.mutate(user.id)}
                          disabled={removeUserFromOrg.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!orgUsersResponse?.data?.length && (
                    <tr>
                      <td colSpan={3} className="py-6 text-center text-muted-foreground">
                        No users found in this organization
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
