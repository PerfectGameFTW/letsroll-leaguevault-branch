import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Layout } from '@/components/layout';
import { AdminRouteGuard } from '@/components/admin-route-guard';
import { OrganizationUsersOnly } from '@/components/organization-users-only';
import { 
  AlertCircle, 
  Building, 
  Building2, 
  Users, 
  UserCog, 
  Plus, 
  Trash2,
  ChevronDown
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Define types for admin user management
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

// Component for loading state
function LoadingState() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-[300px] w-full rounded-md" />
    </div>
  );
}

// Component for error state
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



// User management component - filtered by organization
function UserManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [adminStatuses, setAdminStatuses] = useState<Record<number, boolean>>({});
  
  // Query to fetch current user
  const { data: userResponse } = useQuery<{ success: boolean; data: User }>({
    queryKey: ['/api/user'],
  });
  
  const currentUser = userResponse?.data;
  const organizationId = currentUser?.organizationId;
  
  // Query to fetch users from the same organization
  const { data: usersResponse, isLoading, error } = useQuery<{ success: boolean; data: User[] }>({
    queryKey: ['/api/admin/users'],
    enabled: true,
    select: (data) => {
      // Filter users to only show those from the same organization
      if (data.success && data.data && organizationId) {
        return {
          success: data.success,
          data: data.data.filter(user => user.organizationId === organizationId)
        };
      }
      return data;
    }
  });

  // Mutation to update user admin status
  const updateAdminStatus = useMutation({
    mutationFn: async ({ userId, isAdmin }: { userId: number; isAdmin: boolean }) => {
      return apiRequest(`/api/admin/users/${userId}/admin-status`, 'PATCH', { isAdmin });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      toast({
        title: 'Success',
        description: 'User admin status updated successfully.',
        variant: 'default',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update user admin status.',
        variant: 'destructive',
      });
    },
  });

  // Initialize admin statuses when data is loaded
  useEffect(() => {
    if (usersResponse?.data) {
      const initialStatuses: Record<number, boolean> = {};
      usersResponse.data.forEach(user => {
        initialStatuses[user.id] = user.isAdmin;
      });
      setAdminStatuses(initialStatuses);
    }
  }, [usersResponse?.data]);

  // Handle toggle change
  const handleToggleChange = (userId: number, newStatus: boolean) => {
    // Update local state immediately for responsive UI
    setAdminStatuses(prev => ({
      ...prev,
      [userId]: newStatus
    }));
    
    // Make API call to update user admin status
    updateAdminStatus.mutate({ userId, isAdmin: newStatus });
  };

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error as Error} />;
  if (!usersResponse?.data) return <ErrorState error={new Error('No user data available')} />;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{currentUser?.organizationId ? "Organization Members" : "System Users"}</CardTitle>
          <CardDescription>
            {currentUser?.organizationId 
              ? "Manage members within your organization" 
              : "Manage user accounts and admin privileges"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full">
            <thead>
              <tr className="text-left">
                <th className="pb-2">ID</th>
                <th className="pb-2">Name</th>
                <th className="pb-2">Email</th>
                <th className="pb-2">Bowler ID</th>
                <th className="pb-2">Admin Status</th>
              </tr>
            </thead>
            <tbody>
              {usersResponse.data.map((user) => (
                <tr key={user.id} className="border-t">
                  <td className="py-2">{user.id}</td>
                  <td className="py-2">{user.name || 'N/A'}</td>
                  <td className="py-2">{user.email}</td>
                  <td className="py-2">{user.bowlerId || 'N/A'}</td>
                  <td className="py-2">
                    <div className="flex items-center space-x-2">
                      <Switch 
                        id={`admin-status-${user.id}`}
                        checked={adminStatuses[user.id] || false}
                        onCheckedChange={(checked) => handleToggleChange(user.id, checked)}
                        disabled={updateAdminStatus.isPending}
                      />
                      <span className="text-sm">
                        {adminStatuses[user.id] ? 'Admin' : 'User'}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
              {usersResponse.data.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-center text-muted-foreground">
                    No users found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// Organization User Management Component
function OrganizationUserManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [orgAdminStatuses, setOrgAdminStatuses] = useState<Record<number, boolean>>({});
  const [addUserDialogOpen, setAddUserDialogOpen] = useState(false);
  const [userToAdd, setUserToAdd] = useState<number | null>(null);
  
  // Query to fetch current user
  const { data: userResponse } = useQuery<{ success: boolean; data: User }>({
    queryKey: ['/api/user'],
  });
  
  const currentUser = userResponse?.data;
  const organizationId = currentUser?.organizationId;
  
  // Set organization ID from current user
  const [selectedOrganization, setSelectedOrganization] = useState<number | null>(null);
  
  // Auto-select user's organization when it loads
  useEffect(() => {
    if (organizationId) {
      setSelectedOrganization(organizationId);
    }
  }, [organizationId]);
  
  // Query to fetch organizations - filtered for system admins to see only specific orgs
  const { data: orgsResponse, isLoading: orgsLoading, error: orgsError } = useQuery<{ success: boolean; data: Organization[] }>({
    queryKey: ['/api/organizations'],
    enabled: true,
    select: (data) => {
      // If user is system admin but in an organization, only show their organization
      if (currentUser?.isAdmin && currentUser?.organizationId) {
        return {
          success: data.success,
          data: data.data.filter(org => org.id === currentUser.organizationId)
        };
      }
      return data;
    }
  });

  // Query to fetch all users for adding to organization
  const { data: allUsersResponse, isLoading: allUsersLoading } = useQuery<{ success: boolean; data: User[] }>({
    queryKey: ['/api/admin/users'],
    enabled: true,
  });
  
  // Query to fetch organization users
  const { data: orgUsersResponse, isLoading: orgUsersLoading, error: orgUsersError } = useQuery<{ success: boolean; data: User[] }>({
    queryKey: ['/api/org-admin/users', selectedOrganization],
    queryFn: async ({ queryKey }) => {
      const orgId = queryKey[1];
      if (!orgId) throw new Error("Organization ID is required");
      
      // Log the API request for debugging
      console.log(`[API] Fetching organization users for organizationId: ${orgId}`);
      
      try {
        const response = await fetch(`/api/org-admin/users?organizationId=${orgId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include'
        });
        
        if (!response.ok) {
          console.error(`[API] Error fetching organization users: ${response.status} ${response.statusText}`);
          throw new Error(`Failed to fetch organization users: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('[API] Organization users response:', data);
        return data;
      } catch (error) {
        console.error('[API] Failed to fetch organization users:', error);
        throw error;
      }
    },
    enabled: !!selectedOrganization,
  });
  
  // Mutation to update organization admin status
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
  
  // Mutation to add user to organization
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
  
  // Mutation to remove user from organization
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
  
  if (orgsLoading) return <LoadingState />;
  if (orgsError) return <ErrorState error={orgsError as Error} />;
  
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              <span>Organization Users</span>
            </div>
            {/* Only show organization dropdown for system admins without an organization */}
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
            {/* Show organization name if user is in an organization */}
            {currentUser?.organizationId && orgsResponse?.data && (
              <div className="text-sm font-medium bg-secondary text-secondary-foreground px-4 py-2 rounded-md">
                {orgsResponse.data.find(org => org.id === currentUser.organizationId)?.name || "Your Organization"}
              </div>
            )}
          </CardTitle>
          <CardDescription>
            Manage users and admin privileges within organizations
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!selectedOrganization ? (
            <div className="text-center py-8 text-muted-foreground">
              {currentUser?.isAdmin && !currentUser?.organizationId 
                ? "Please select an organization to manage its users" 
                : "Loading organization data..."}
            </div>
          ) : orgUsersLoading ? (
            <LoadingState />
          ) : orgUsersError ? (
            <ErrorState error={orgUsersError as Error} />
          ) : (
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Main admin page component
export default function AdminPage() {
  // Query to fetch current user
  const { data: userResponse } = useQuery<{ success: boolean; data: User }>({
    queryKey: ['/api/user'],
  });
  
  const currentUser = userResponse?.data;
  
  return (
    <Layout>
      <AdminRouteGuard>
        <div className="container py-6">
          <div className="mb-6">
            <h1 className="text-4xl font-bold">Organization Admin Panel</h1>
            <p className="text-muted-foreground">
              Manage users for your organization
            </p>
          </div>
          
          {/* Show only organization users management */}
          <div className="mt-6">
            {currentUser?.isAdmin && currentUser?.organizationId ? (
              <OrganizationUserManagement />
            ) : (
              <OrganizationUsersOnly />
            )}
          </div>
        </div>
      </AdminRouteGuard>
    </Layout>
  );
}