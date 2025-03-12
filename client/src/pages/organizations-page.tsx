import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Edit, Trash } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import type { Organization, InsertOrganization } from '@shared/schema.js';

export default function OrganizationsPage() {
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  
  // New admin user details (always create a new admin for a new organization)
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<{data: Organization[]}>({
    queryKey: ['/api/organizations'],
    retry: 1,
  });

  const createMutation = useMutation<
    any,
    Error,
    InsertOrganization,
    unknown
  >({
    mutationFn: async (org: InsertOrganization) => {
      return apiRequest('/api/organizations', 'POST', org);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/organizations'] });
      toast({
        title: 'Organization Created',
        description: 'The organization has been successfully created.',
      });
      resetForm();
      setOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: `Failed to create organization: ${error.message}`,
        variant: 'destructive',
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, org }: { id: number; org: Partial<InsertOrganization> }) => {
      return apiRequest(`/api/organizations/${id}`, 'PATCH', org);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/organizations'] });
      toast({
        title: 'Organization Updated',
        description: 'The organization has been successfully updated.',
      });
      resetForm();
      setOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: `Failed to update organization: ${error.message}`,
        variant: 'destructive',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/organizations/${id}`, 'DELETE');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/organizations'] });
      toast({
        title: 'Organization Deleted',
        description: 'The organization has been successfully deleted.',
      });
      setDeleteConfirmId(null);
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: `Failed to delete organization: ${error.message}`,
        variant: 'destructive',
      });
    },
  });

  const resetForm = () => {
    setName('');
    setSlug('');
    setAddress('');
    setCity('');
    setState('');
    setZipCode('');
    setPhone('');
    setEmail('');
    setAdminName('');
    setAdminEmail('');
    setAdminPhone('');
    setAdminPassword('');
    setEditId(null);
  };

  const handleEditClick = (org: Organization) => {
    setEditId(org.id);
    setName(org.name);
    setSlug(org.slug);
    setAddress(org.address || '');
    setCity(org.city || '');
    setState(org.state || '');
    setZipCode(org.zipCode || '');
    setPhone(org.phone || '');
    setEmail(org.email || '');
    setOpen(true);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!editId) {
      // For new organizations, validate admin information
      if (!adminName || !adminEmail || !adminPassword) {
        toast({
          title: 'Missing Administrator Information',
          description: 'Please fill out all required administrator fields.',
          variant: 'destructive',
        });
        return;
      }

      // Simple email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(adminEmail)) {
        toast({
          title: 'Invalid Email',
          description: 'Please enter a valid email address for the administrator.',
          variant: 'destructive',
        });
        return;
      }

      // Simple password validation
      if (adminPassword.length < 8) {
        toast({
          title: 'Password Too Short',
          description: 'Administrator password must be at least 8 characters long.',
          variant: 'destructive',
        });
        return;
      }
    }
    
    const orgData = {
      name,
      slug,
      address,
      city,
      state,
      zipCode,
      phone,
      email,
    };

    if (editId) {
      updateMutation.mutate({ id: editId, org: orgData });
    } else {
      // Always prepare admin data for new organizations
      const adminData = {
        name: adminName,
        email: adminEmail,
        password: adminPassword,
        phone: adminPhone || null
      };

      // Create the organization with admin data and set active status
      const dataToSend = { 
        ...orgData,
        active: true, 
        adminData
      };

      createMutation.mutate(dataToSend as unknown as InsertOrganization);
    }
  };

  const generateSlug = () => {
    if (!name) return;
    
    const newSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    
    setSlug(newSlug);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-10">
        <h1 className="text-3xl font-bold mb-6">Organizations</h1>
        <p>Loading organizations...</p>
      </div>
    );
  }

  if (error) {
    // Check if it's an auth error - if so, show a more user-friendly message
    const errorMessage = (error as Error).message;
    const isAuthError = errorMessage.includes('not_authenticated') || 
                        errorMessage.includes('not authenticated') ||
                        errorMessage.includes('unauthorized');
    
    return (
      <div className="container mx-auto py-10">
        <h1 className="text-3xl font-bold mb-6">Organizations</h1>
        <div className="bg-destructive/10 border border-destructive p-4 rounded-md mb-6">
          <h3 className="text-lg font-semibold text-destructive mb-2">
            {isAuthError ? 'Authentication Required' : 'Error Loading Organizations'}
          </h3>
          <p className="text-muted-foreground">
            {isAuthError 
              ? 'You must be logged in to view organizations. Please log in and try again.'
              : `Failed to load organizations: ${errorMessage}`
            }
          </p>
          {isAuthError && (
            <div className="mt-4">
              <Button variant="default" onClick={() => window.location.href = '/login'}>
                Log In
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const organizations = data?.data || [];

  return (
    <div className="container mx-auto py-10">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Organizations</h1>
        <Button onClick={() => { resetForm(); setOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" /> Add Organization
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Organizations</CardTitle>
          <CardDescription>Manage all organizations in the system</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {organizations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center">
                    No organizations found
                  </TableCell>
                </TableRow>
              ) : (
                organizations.map((org: Organization) => (
                  <TableRow key={org.id}>
                    <TableCell className="font-medium">{org.name}</TableCell>
                    <TableCell>{org.slug}</TableCell>
                    <TableCell>{org.email || '—'}</TableCell>
                    <TableCell>{org.phone || '—'}</TableCell>
                    <TableCell>
                      <div className="flex space-x-2">
                        <Button variant="outline" size="sm" onClick={() => handleEditClick(org)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="destructive" 
                          size="sm"
                          onClick={() => setDeleteConfirmId(org.id)}
                        >
                          <Trash className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create/Edit Organization Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[525px]">
          <DialogHeader>
            <DialogTitle>
              {editId ? 'Edit Organization' : 'Create Organization'}
            </DialogTitle>
            <DialogDescription>
              {editId 
                ? 'Update the organization details below.' 
                : 'Add a new organization to the system with an administrator account.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleFormSubmit}>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="name" className="text-right">
                  Name
                </Label>
                <Input
                  id="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={generateSlug}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="slug" className="text-right">
                  Slug
                </Label>
                <Input
                  id="slug"
                  required
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="col-span-3"
                  placeholder="org-name"
                />
              </div>
              
              {!editId && (
                <>
                  <div className="mt-4 mb-2">
                    <h3 className="text-lg font-medium">Administrator Account</h3>
                    <p className="text-sm text-muted-foreground">
                      Create an administrator account for this organization
                    </p>
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="adminName" className="text-right">
                      Admin Name
                    </Label>
                    <Input
                      id="adminName"
                      value={adminName}
                      onChange={(e) => setAdminName(e.target.value)}
                      className="col-span-3"
                      required={!editId}
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="adminEmail" className="text-right">
                      Admin Email
                    </Label>
                    <Input
                      id="adminEmail"
                      type="email"
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      className="col-span-3"
                      required={!editId}
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="adminPassword" className="text-right">
                      Admin Password
                    </Label>
                    <Input
                      id="adminPassword"
                      type="password"
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      className="col-span-3"
                      required={!editId}
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="adminPhone" className="text-right">
                      Admin Phone
                    </Label>
                    <Input
                      id="adminPhone"
                      value={adminPhone}
                      onChange={(e) => setAdminPhone(e.target.value)}
                      className="col-span-3"
                    />
                  </div>
                </>
              )}
              
              <div className="mt-4 mb-2">
                <h3 className="text-lg font-medium">Organization Details</h3>
                <p className="text-sm text-muted-foreground">
                  Additional organization information
                </p>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="email" className="text-right">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="phone" className="text-right">
                  Phone
                </Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="address" className="text-right">
                  Address
                </Label>
                <Input
                  id="address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="city" className="text-right">
                  City
                </Label>
                <Input
                  id="city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="state" className="text-right">
                  State
                </Label>
                <Input
                  id="state"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="zipCode" className="text-right">
                  ZIP Code
                </Label>
                <Input
                  id="zipCode"
                  value={zipCode}
                  onChange={(e) => setZipCode(e.target.value)}
                  className="col-span-3"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {editId ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will permanently delete the organization and cannot be undone.
              This will also remove all data associated with this organization including leagues, teams, and bowlers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete Organization'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}