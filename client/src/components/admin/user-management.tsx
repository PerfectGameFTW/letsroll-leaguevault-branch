import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { UserEditDialog } from '@/components/user-edit-dialog';
import { AlertCircle } from 'lucide-react';
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

export function UserManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [adminStatuses, setAdminStatuses] = useState<Record<number, boolean>>({});
  
  const { data: userResponse } = useQuery<{ success: boolean; data: User }>({
    queryKey: ['/api/user'],
  });
  
  const currentUser = userResponse?.data;
  const organizationId = currentUser?.organizationId;
  
  const { data: usersResponse, isLoading, error } = useQuery<{ success: boolean; data: User[] }>({
    queryKey: ['/api/admin/users'],
    enabled: true,
    select: (data) => {
      if (data.success && data.data && organizationId) {
        return {
          success: data.success,
          data: data.data.filter(user => user.organizationId === organizationId)
        };
      }
      return data;
    }
  });

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

  useEffect(() => {
    if (usersResponse?.data) {
      const initialStatuses: Record<number, boolean> = {};
      usersResponse.data.forEach(user => {
        initialStatuses[user.id] = user.isAdmin;
      });
      setAdminStatuses(initialStatuses);
    }
  }, [usersResponse?.data]);

  const handleToggleChange = (userId: number, newStatus: boolean) => {
    setAdminStatuses(prev => ({
      ...prev,
      [userId]: newStatus
    }));
    
    updateAdminStatus.mutate({ userId, isAdmin: newStatus });
  };

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error as Error} />;
  if (!usersResponse?.data) return <ErrorState error={new Error('No user data available')} />;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full">
            <thead>
              <tr className="text-left">
                <th className="pb-2">ID</th>
                <th className="pb-2">Name</th>
                <th className="pb-2">Email</th>
                <th className="pb-2">Bowler ID</th>
              </tr>
            </thead>
            <tbody>
              {usersResponse.data.map((user) => (
                <tr key={user.id} className="border-t">
                  <td className="py-2">{user.id}</td>
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
                  <td className="py-2">{user.bowlerId || 'N/A'}</td>
                </tr>
              ))}
              {usersResponse.data.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-center text-muted-foreground">
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
