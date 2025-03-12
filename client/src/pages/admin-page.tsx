import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Layout } from '@/components/layout';
import { AdminRouteGuard } from '@/components/admin-route-guard';
import { AlertCircle, Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// Define types for admin user management
interface User {
  id: number;
  email: string;
  name: string | null;
  isAdmin: boolean;
  bowlerId: number | null;
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



// User management component
function UserManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [adminStatuses, setAdminStatuses] = useState<Record<number, boolean>>({});
  
  // Query to fetch users
  const { data: usersResponse, isLoading, error } = useQuery<{ success: boolean; data: User[] }>({
    queryKey: ['/api/admin/users'],
    enabled: true,
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
      <h2 className="text-3xl font-bold tracking-tight">User Management</h2>
      
      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            Manage user accounts and admin privileges
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

// Main admin page component
export default function AdminPage() {
  return (
    <Layout>
      <AdminRouteGuard>
        <div className="container py-6">
          <div className="mb-6">
            <h1 className="text-4xl font-bold">Admin Panel</h1>
            <p className="text-muted-foreground">Manage user accounts and admin privileges</p>
          </div>
          
          <UserManagement />
        </div>
      </AdminRouteGuard>
    </Layout>
  );
}