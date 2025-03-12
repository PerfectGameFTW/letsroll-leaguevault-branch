import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Layout } from '@/components/layout';
import { AlertCircle, CheckCircle, Users, BarChart3, DollarSign, Calendar } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// Define types for admin dashboard data
interface User {
  id: number;
  email: string;
  name: string | null;
  isAdmin: boolean;
  bowlerId: number | null;
}

interface DashboardStats {
  bowlers: {
    total: number;
    active: number;
  };
  leagues: {
    total: number;
    active: number;
  };
  teams: {
    total: number;
    active: number;
  };
  payments: {
    total: number;
    paid: number;
    pending: number;
    totalAmountPaid: number;
  };
  recentPayments: Array<{
    id: number;
    amount: number;
    status: string;
    type: string;
    bowlerId: number;
    createdAt: string;
  }>;
}

// Component for loading state
function LoadingState() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-full" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
      <Skeleton className="h-64 w-full" />
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
        {error.message || 'Unable to load admin dashboard. Please try again later.'}
      </AlertDescription>
    </Alert>
  );
}

// Dashboard component
function AdminDashboard() {
  const { data: stats, isLoading, error } = useQuery<{ success: boolean; data: DashboardStats }>({
    queryKey: ['/api/admin/dashboard'],
    enabled: true,
  });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error as Error} />;
  if (!stats?.data) return <ErrorState error={new Error('No data available')} />;

  const dashboardData = stats.data;
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount / 100);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Bowlers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">{dashboardData.bowlers.total}</div>
              <Users className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {dashboardData.bowlers.active} active ({Math.round((dashboardData.bowlers.active / dashboardData.bowlers.total) * 100)}%)
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Leagues</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">{dashboardData.leagues.total}</div>
              <Calendar className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {dashboardData.leagues.active} active ({Math.round((dashboardData.leagues.active / dashboardData.leagues.total) * 100)}%)
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Teams</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">{dashboardData.teams.total}</div>
              <BarChart3 className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {dashboardData.teams.active} active ({Math.round((dashboardData.teams.active / dashboardData.teams.total) * 100)}%)
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Payments</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">{formatCurrency(dashboardData.payments.totalAmountPaid)}</div>
              <DollarSign className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {dashboardData.payments.paid} paid / {dashboardData.payments.pending} pending
            </p>
          </CardContent>
        </Card>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>Recent Payments</CardTitle>
          <CardDescription>Recent payments processed in the system</CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full">
            <thead>
              <tr className="text-left">
                <th className="pb-2">ID</th>
                <th className="pb-2">Amount</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Type</th>
                <th className="pb-2">Bowler ID</th>
                <th className="pb-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {dashboardData.recentPayments.map((payment) => (
                <tr key={payment.id} className="border-t">
                  <td className="py-2">{payment.id}</td>
                  <td className="py-2">{formatCurrency(payment.amount)}</td>
                  <td className="py-2">
                    <Badge variant={payment.status === 'paid' ? 'default' : 'secondary'}>
                      {payment.status}
                    </Badge>
                  </td>
                  <td className="py-2">{payment.type}</td>
                  <td className="py-2">{payment.bowlerId}</td>
                  <td className="py-2">{formatDate(payment.createdAt)}</td>
                </tr>
              ))}
              {dashboardData.recentPayments.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-3 text-center text-muted-foreground">
                    No recent payments
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
      <div className="container py-6">
        <div className="mb-6">
          <h1 className="text-4xl font-bold">Admin Panel</h1>
          <p className="text-muted-foreground">Manage system settings and users</p>
        </div>
        
        <Tabs defaultValue="dashboard">
          <TabsList className="mb-6">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="users">User Management</TabsTrigger>
          </TabsList>
          
          <TabsContent value="dashboard">
            <AdminDashboard />
          </TabsContent>
          
          <TabsContent value="users">
            <UserManagement />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}