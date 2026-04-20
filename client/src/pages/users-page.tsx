import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Layout } from '@/components/layout';
import { ProtectedRoute } from '@/components/protected-route';
import { ErrorBoundary } from '@/components/error-boundary';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Plus, Trash2, Shield, MapPin, Send, Link2, Unlink2 } from 'lucide-react';

interface LinkedBowler {
  id: number;
  name: string;
  leagueName: string | null;
  teamName: string | null;
}

interface User {
  id: number;
  email: string;
  name: string | null;
  role: string;
  organizationId: number | null;
  locationId: number | null;
  bowlerId: number | null;
  inviteToken: string | null;
  createdAt: string;
  linkedBowler: LinkedBowler | null;
}

interface Location {
  id: number;
  name: string;
  organizationId: number;
}

export default function UsersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteUserId, setDeleteUserId] = useState<number | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('user');
  const [locationId, setLocationId] = useState<string>('none');

  const { data: currentUserResponse } = useQuery<{ success: boolean; data: User }>({
    queryKey: ['/api/user'],
  });
  const currentUser = currentUserResponse?.data;
  const organizationId = currentUser?.organizationId;

  const { data: orgUsersResponse, isLoading: orgUsersLoading } = useQuery<{ success: boolean; data: User[] }>({
    queryKey: ['/api/org-admin/users', organizationId],
    queryFn: async () => {
      const response = await fetch(`/api/org-admin/users?organizationId=${organizationId}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch users');
      return response.json();
    },
    enabled: !!organizationId,
  });

  const { data: locationsResponse } = useQuery<{ success: boolean; data: Location[] }>({
    queryKey: ['/api/locations'],
  });

  const orgUsers = orgUsersResponse?.data || [];
  const locations = locationsResponse?.data || [];
  const orgLocations = locations.filter(l => l.organizationId === organizationId);

  const createUserMutation = useMutation({
    mutationFn: async (data: { firstName: string; lastName: string; email: string; makeOrgAdmin: boolean; locationId: number | null }) => {
      return apiRequest('/api/org-admin/users/create', 'POST', data);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/org-admin/users'] });
      resetAddForm();
      const emailSent = data?.emailSent !== false;
      toast({
        title: 'User created',
        description: emailSent
          ? 'An email has been sent to the user to set up their password.'
          : 'User created but the invitation email could not be sent. You can resend it from the user list.',
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const removeUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      await apiRequest(`/api/org-admin/users/${userId}/remove`, 'DELETE');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/org-admin/users'] });
      setDeleteUserId(null);
      toast({ title: 'User removed', description: 'User has been removed from the organization.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, makeOrgAdmin }: { userId: number; makeOrgAdmin: boolean }) => {
      return apiRequest(`/api/org-admin/users/${userId}/admin-status`, 'PATCH', { makeOrgAdmin });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/org-admin/users'] });
      toast({ title: 'Role updated', description: 'User role has been updated.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const updateLocationMutation = useMutation({
    mutationFn: async ({ userId, locationId }: { userId: number; locationId: number | null }) => {
      return apiRequest(`/api/org-admin/users/${userId}/location`, 'PATCH', { locationId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/org-admin/users'] });
      toast({ title: 'Location updated', description: 'User location assignment has been updated.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const resendInviteMutation = useMutation({
    mutationFn: async (userId: number) => {
      return apiRequest(`/api/org-admin/users/${userId}/resend-invite`, 'POST');
    },
    onSuccess: () => {
      toast({ title: 'Invite sent', description: 'A new invitation email has been sent.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const resetAddForm = () => {
    setAddDialogOpen(false);
    setFirstName('');
    setLastName('');
    setEmail('');
    setRole('user');
    setLocationId('none');
  };

  const getUserToDelete = deleteUserId ? orgUsers.find(u => u.id === deleteUserId) : null;

  const hasPendingInvite = (user: User) => !!user.inviteToken;

  return (
    <Layout>
      <ProtectedRoute requirement="systemAdmin">
        <ErrorBoundary level="section">
        <div className="container py-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-4xl font-bold">Users</h1>
            <Button onClick={() => setAddDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add User
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Organization Users</CardTitle>
            </CardHeader>
            <CardContent>
              {orgUsersLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : orgUsers.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No users in this organization yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Linked Bowler</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="w-[120px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orgUsers.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">{user.name || '—'}</TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>
                          {user.linkedBowler ? (
                            <div className="flex items-center gap-1.5">
                              <Link2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                              <div className="text-sm">
                                <span className="font-medium">{user.linkedBowler.name}</span>
                                {(user.linkedBowler.teamName || user.linkedBowler.leagueName) && (
                                  <span className="text-muted-foreground">
                                    {' — '}
                                    {[user.linkedBowler.teamName, user.linkedBowler.leagueName].filter(Boolean).join(', ')}
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <Unlink2 className="h-3.5 w-3.5 shrink-0" />
                              Unlinked
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {hasPendingInvite(user) ? (
                            <Badge variant="outline" className="text-amber-600 border-amber-300">Pending</Badge>
                          ) : (
                            <Badge variant="outline" className="text-green-600 border-green-300">Active</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={user.role === 'org_admin' || user.role === 'system_admin' ? 'admin' : 'user'}
                            onValueChange={(value) => {
                              if (user.id === currentUser?.id) {
                                toast({ title: 'Error', description: 'You cannot change your own role.', variant: 'destructive' });
                                return;
                              }
                              updateRoleMutation.mutate({
                                userId: user.id,
                                makeOrgAdmin: value === 'admin',
                              });
                            }}
                            disabled={user.id === currentUser?.id}
                          >
                            <SelectTrigger className="w-[160px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="user">
                                <span className="flex items-center gap-1.5">
                                  <MapPin className="h-3.5 w-3.5" />
                                  End User
                                </span>
                              </SelectItem>
                              <SelectItem value="admin">
                                <span className="flex items-center gap-1.5">
                                  <Shield className="h-3.5 w-3.5" />
                                  Admin
                                </span>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {user.role === 'org_admin' || user.role === 'system_admin' ? (
                            <Badge variant="secondary">All Locations</Badge>
                          ) : (
                            <Select
                              value={user.locationId ? String(user.locationId) : 'none'}
                              onValueChange={(value) => {
                                updateLocationMutation.mutate({
                                  userId: user.id,
                                  locationId: value === 'none' ? null : parseInt(value),
                                });
                              }}
                            >
                              <SelectTrigger className="w-[180px]">
                                <SelectValue placeholder="Select location" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">No location</SelectItem>
                                {orgLocations.map((loc) => (
                                  <SelectItem key={loc.id} value={String(loc.id)}>
                                    {loc.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {hasPendingInvite(user) && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => resendInviteMutation.mutate(user.id)}
                                disabled={resendInviteMutation.isPending}
                                title="Resend invite email"
                              >
                                <Send className="h-4 w-4" />
                              </Button>
                            )}
                            {user.id !== currentUser?.id && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDeleteUserId(user.id)}
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Dialog open={addDialogOpen} onOpenChange={(open) => { if (!open) resetAddForm(); else setAddDialogOpen(true); }}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add New User</DialogTitle>
                <DialogDescription>
                  Create a new user account. They will receive an email to set up their password.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="firstName">First Name</Label>
                    <Input
                      id="firstName"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="First name"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="lastName">Last Name</Label>
                    <Input
                      id="lastName"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Last name"
                      className="mt-1"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="user@example.com"
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label>Role</Label>
                  <Select value={role} onValueChange={setRole}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">End User — can only access their assigned location</SelectItem>
                      <SelectItem value="admin">Admin — can access all locations</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {role === 'user' && (
                  <div>
                    <Label>Assign Location</Label>
                    <Select value={locationId} onValueChange={setLocationId}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select location" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No location</SelectItem>
                        {orgLocations.map((loc) => (
                          <SelectItem key={loc.id} value={String(loc.id)}>
                            {loc.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={resetAddForm}>
                  Cancel
                </Button>
                <Button
                  disabled={!firstName.trim() || !lastName.trim() || !email.trim() || createUserMutation.isPending}
                  onClick={() => {
                    createUserMutation.mutate({
                      firstName: firstName.trim(),
                      lastName: lastName.trim(),
                      email: email.trim(),
                      makeOrgAdmin: role === 'admin',
                      locationId: role === 'admin' || locationId === 'none' ? null : parseInt(locationId),
                    });
                  }}
                >
                  {createUserMutation.isPending ? 'Creating...' : 'Create User'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={!!deleteUserId} onOpenChange={(open) => !open && setDeleteUserId(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Remove User</DialogTitle>
                <DialogDescription>
                  Are you sure you want to remove {getUserToDelete?.name || getUserToDelete?.email} from the organization? They will lose access to all organization data.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteUserId(null)}>Cancel</Button>
                <Button
                  variant="destructive"
                  onClick={() => deleteUserId && removeUserMutation.mutate(deleteUserId)}
                >
                  {removeUserMutation.isPending ? 'Removing...' : 'Remove'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        </ErrorBoundary>
      </ProtectedRoute>
    </Layout>
  );
}
