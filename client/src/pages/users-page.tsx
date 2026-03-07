import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Layout } from '@/components/layout';
import { AdminRouteGuard } from '@/components/admin-route-guard';
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
import { Plus, Trash2, Shield, MapPin, Search } from 'lucide-react';

interface User {
  id: number;
  email: string;
  name: string | null;
  isAdmin: boolean;
  isOrganizationAdmin: boolean;
  organizationId: number | null;
  locationId: number | null;
  bowlerId: number | null;
  createdAt: string;
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
  const [searchQuery, setSearchQuery] = useState('');
  const [userToAdd, setUserToAdd] = useState<number | null>(null);
  const [addAsAdmin, setAddAsAdmin] = useState(false);
  const [addLocationId, setAddLocationId] = useState<string>('none');

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

  const { data: allUsersResponse } = useQuery<{ success: boolean; data: User[] }>({
    queryKey: ['/api/admin/users'],
  });

  const { data: locationsResponse } = useQuery<{ success: boolean; data: Location[] }>({
    queryKey: ['/api/locations'],
  });

  const orgUsers = orgUsersResponse?.data || [];
  const allUsers = allUsersResponse?.data || [];
  const locations = locationsResponse?.data || [];
  const orgLocations = locations.filter(l => l.organizationId === organizationId);

  const availableUsers = useMemo(() => {
    const orgUserIds = new Set(orgUsers.map(u => u.id));
    return allUsers
      .filter(u => !orgUserIds.has(u.id) && !u.organizationId)
      .filter(u => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (u.email?.toLowerCase().includes(q) || u.name?.toLowerCase().includes(q));
      });
  }, [allUsers, orgUsers, searchQuery]);

  const addUserMutation = useMutation({
    mutationFn: async ({ userId, isOrganizationAdmin, locationId }: { userId: number; isOrganizationAdmin: boolean; locationId: number | null }) => {
      await apiRequest(`/api/org-admin/users/${userId}/add`, 'POST', {
        organizationId,
        isOrganizationAdmin,
      });
      if (locationId) {
        await apiRequest(`/api/org-admin/users/${userId}/location`, 'PATCH', { locationId });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/org-admin/users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      setAddDialogOpen(false);
      setUserToAdd(null);
      setAddAsAdmin(false);
      setAddLocationId('none');
      setSearchQuery('');
      toast({ title: 'User added', description: 'User has been added to the organization.' });
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
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      setDeleteUserId(null);
      toast({ title: 'User removed', description: 'User has been removed from the organization.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, isOrganizationAdmin }: { userId: number; isOrganizationAdmin: boolean }) => {
      return apiRequest(`/api/org-admin/users/${userId}/admin-status`, 'PATCH', { isOrganizationAdmin });
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

  const getLocationName = (locationId: number | null) => {
    if (!locationId) return null;
    return locations.find(l => l.id === locationId)?.name || 'Unknown';
  };

  const getUserToDelete = deleteUserId ? orgUsers.find(u => u.id === deleteUserId) : null;

  return (
    <Layout>
      <AdminRouteGuard>
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
                      <TableHead>Role</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="w-[80px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orgUsers.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">{user.name || '—'}</TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>
                          <Select
                            value={user.isOrganizationAdmin ? 'admin' : 'user'}
                            onValueChange={(value) => {
                              if (user.id === currentUser?.id) {
                                toast({ title: 'Error', description: 'You cannot change your own role.', variant: 'destructive' });
                                return;
                              }
                              updateRoleMutation.mutate({
                                userId: user.id,
                                isOrganizationAdmin: value === 'admin',
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
                                  Location User
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
                          {user.isOrganizationAdmin ? (
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
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add User to Organization</DialogTitle>
                <DialogDescription>
                  Search for an existing user to add to your organization.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <Label>Search Users</Label>
                  <div className="relative mt-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name or email..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>

                {availableUsers.length > 0 ? (
                  <div className="max-h-[200px] overflow-y-auto border rounded-md">
                    {availableUsers.map((user) => (
                      <div
                        key={user.id}
                        className={`flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-muted ${
                          userToAdd === user.id ? 'bg-primary/10 border-l-2 border-primary' : ''
                        }`}
                        onClick={() => setUserToAdd(user.id)}
                      >
                        <div>
                          <p className="text-sm font-medium">{user.name || 'Unnamed'}</p>
                          <p className="text-xs text-muted-foreground">{user.email}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : searchQuery ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No matching users found.</p>
                ) : null}

                {userToAdd && (
                  <>
                    <div>
                      <Label>Role</Label>
                      <Select value={addAsAdmin ? 'admin' : 'user'} onValueChange={(v) => setAddAsAdmin(v === 'admin')}>
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">Location User — can only see/edit at one location</SelectItem>
                          <SelectItem value="admin">Admin — can see/edit all locations</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {!addAsAdmin && (
                      <div>
                        <Label>Assign Location</Label>
                        <Select value={addLocationId} onValueChange={setAddLocationId}>
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
                  </>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => { setAddDialogOpen(false); setUserToAdd(null); setSearchQuery(''); }}>
                  Cancel
                </Button>
                <Button
                  disabled={!userToAdd || addUserMutation.isPending}
                  onClick={() => {
                    if (!userToAdd) return;
                    addUserMutation.mutate({
                      userId: userToAdd,
                      isOrganizationAdmin: addAsAdmin,
                      locationId: addAsAdmin || addLocationId === 'none' ? null : parseInt(addLocationId),
                    });
                  }}
                >
                  {addUserMutation.isPending ? 'Adding...' : 'Add User'}
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
      </AdminRouteGuard>
    </Layout>
  );
}
