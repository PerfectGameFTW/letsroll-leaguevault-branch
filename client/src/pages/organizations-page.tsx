import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Edit, Trash, Upload, X, Archive, RotateCcw, AlertTriangle, ExternalLink } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import type { Organization, InsertOrganization, User } from '@shared/schema.js';
import { Layout } from "@/components/layout";
import { Badge } from '@/components/ui/badge';

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
  const [logo, setLogo] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // New admin user details (always create a new admin for a new organization)
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [archiveConfirmId, setArchiveConfirmId] = useState<number | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: userData } = useQuery<{success: boolean, data: User}>({
    queryKey: ['/api/user'],
  });
  const currentUser = userData?.data;

  const switchOrgMutation = useMutation({
    mutationFn: async (orgId: number) => {
      if (!currentUser) return;
      return apiRequest(`/api/organizations/user/${currentUser.id}/set`, 'POST', { organizationId: orgId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });
      setLocation('/home');
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: `Failed to switch organization: ${error.message}`,
        variant: 'destructive',
      });
    },
  });

  const { data, isLoading, error } = useQuery<{success: boolean, data: Organization[]}>({
    queryKey: ['/api/organizations'],
    retry: 1,
    staleTime: 60000, // 1 minute
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const createMutation = useMutation<
    any,
    Error,
    InsertOrganization,
    unknown
  >({
    mutationFn: async (org: InsertOrganization) => {
      return apiRequest('POST', '/api/organizations', org);
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
        description: 'The organization and all its data have been permanently deleted.',
      });
      setDeleteConfirmId(null);
      setDeleteConfirmName('');
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: `Failed to delete organization: ${error.message}`,
        variant: 'destructive',
      });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/organizations/${id}/archive`, 'PATCH');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/organizations'] });
      toast({
        title: 'Organization Archived',
        description: 'The organization has been archived and hidden from normal views.',
      });
      setArchiveConfirmId(null);
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: `Failed to archive organization: ${error.message}`,
        variant: 'destructive',
      });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/organizations/${id}/restore`, 'PATCH');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/organizations'] });
      toast({
        title: 'Organization Restored',
        description: 'The organization has been restored and is now active again.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: `Failed to restore organization: ${error.message}`,
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
    setLogo(null);
    setLogoPreview(null);
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
    setLogo(org.logo || null);
    setLogoPreview(org.logo || null);
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
      logo: logo || undefined, // Convert null to undefined for API compatibility
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
      <Layout>
        <div className="container mx-auto py-10">
          <h1 className="text-3xl font-bold mb-6">Organizations</h1>
          <p>Loading organizations...</p>
        </div>
      </Layout>
    );
  }

  if (error) {
    // Check if it's an auth error - if so, show a more user-friendly message
    const errorMessage = (error as Error).message;
    const isAuthError = errorMessage.includes('not_authenticated') || 
                        errorMessage.includes('not authenticated') ||
                        errorMessage.includes('unauthorized');
    
    return (
      <Layout>
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
      </Layout>
    );
  }

  const allOrganizations = data?.data || [];
  const organizations = showArchived ? allOrganizations : allOrganizations.filter(o => o.active !== false);
  const archivedCount = allOrganizations.filter(o => o.active === false).length;

  return (
    <Layout>
      <div className="container mx-auto py-10">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Organizations</h1>
          <Button onClick={() => { resetForm(); setOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Add Organization
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Organizations</CardTitle>
                <CardDescription>Manage all organizations in the system</CardDescription>
              </div>
              {archivedCount > 0 && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="show-archived" className="text-sm text-muted-foreground cursor-pointer">
                    Show archived ({archivedCount})
                  </Label>
                  <Switch
                    id="show-archived"
                    checked={showArchived}
                    onCheckedChange={setShowArchived}
                  />
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {organizations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center">
                      No organizations found
                    </TableCell>
                  </TableRow>
                ) : (
                  organizations.map((org: Organization) => (
                    <TableRow key={org.id} className={org.active === false ? 'opacity-60' : ''}>
                      <TableCell className="font-medium">
                        {org.active !== false ? (
                          <button
                            className="inline-flex items-center gap-1.5 text-left hover:text-primary hover:underline transition-colors cursor-pointer"
                            onClick={() => switchOrgMutation.mutate(org.id)}
                            disabled={switchOrgMutation.isPending}
                          >
                            {org.name}
                            <ExternalLink className="h-3.5 w-3.5 opacity-50" />
                          </button>
                        ) : (
                          org.name
                        )}
                      </TableCell>
                      <TableCell>{org.slug}</TableCell>
                      <TableCell>
                        {org.active === false ? (
                          <Badge variant="secondary">Archived</Badge>
                        ) : (
                          <Badge variant="default">Active</Badge>
                        )}
                      </TableCell>
                      <TableCell>{org.email || '—'}</TableCell>
                      <TableCell>{org.phone || '—'}</TableCell>
                      <TableCell>
                        <div className="flex space-x-2">
                          <Button variant="outline" size="sm" onClick={() => handleEditClick(org)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          {org.active === false ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => restoreMutation.mutate(org.id)}
                              disabled={restoreMutation.isPending}
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setArchiveConfirmId(org.id)}
                            >
                              <Archive className="h-4 w-4" />
                            </Button>
                          )}
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
          <DialogContent className="sm:max-w-[525px] max-h-[90vh] overflow-y-auto">
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
                
                <div className="grid grid-cols-4 items-start gap-4 mt-4">
                  <Label htmlFor="logo" className="text-right pt-2">
                    Logo
                  </Label>
                  <div className="col-span-3 space-y-2">
                    {logoPreview ? (
                      <div className="relative w-40 h-40 rounded-md overflow-hidden border">
                        <img 
                          src={logoPreview} 
                          alt="Organization logo" 
                          className="w-full h-full object-contain"
                        />
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute top-1 right-1 h-6 w-6 rounded-full"
                          onClick={() => {
                            setLogo(null);
                            setLogoPreview(null);
                            if (fileInputRef.current) {
                              fileInputRef.current.value = '';
                            }
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="w-full">
                        <div className="flex items-center gap-2">
                          <Input
                            ref={fileInputRef}
                            type="file"
                            id="logo"
                            accept="image/*"
                            className="flex-1"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              
                              // Check file size (max 2MB)
                              if (file.size > 2 * 1024 * 1024) {
                                toast({
                                  title: "File too large",
                                  description: "The logo file must be less than 2MB.",
                                  variant: "destructive",
                                });
                                return;
                              }
                              
                              // Read file as base64
                              const reader = new FileReader();
                              reader.onload = (event) => {
                                const base64 = event.target?.result as string;
                                setLogo(base64);
                                setLogoPreview(base64);
                              };
                              reader.readAsDataURL(file);
                            }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Upload your organization logo (PNG, JPG, SVG - max 2MB).
                        </p>
                      </div>
                    )}
                  </div>
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

        {/* Archive Confirmation Dialog */}
        <AlertDialog open={!!archiveConfirmId} onOpenChange={(open) => { if (!open) setArchiveConfirmId(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive Organization</AlertDialogTitle>
              <AlertDialogDescription>
                This will hide the organization from normal views. The organization and all its data will be preserved and can be restored at any time.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => archiveConfirmId && archiveMutation.mutate(archiveConfirmId)}
                disabled={archiveMutation.isPending}
              >
                {archiveMutation.isPending ? 'Archiving...' : 'Archive Organization'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Permanent Delete Confirmation Dialog */}
        <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) { setDeleteConfirmId(null); setDeleteConfirmName(''); } }}>
          <AlertDialogContent className="max-h-[90vh] overflow-y-auto">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                Permanently Delete Organization
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <p className="font-semibold text-destructive">
                    This action is irreversible and cannot be undone.
                  </p>
                  <p>
                    Permanently deleting this organization will also delete:
                  </p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>All leagues belonging to this organization</li>
                    <li>All teams within those leagues</li>
                    <li>All bowler-league memberships</li>
                    <li>All payment records</li>
                    <li>All game and score history</li>
                    <li>All payment schedules</li>
                  </ul>
                  <p className="text-sm">
                    Consider archiving instead if you may need this data in the future.
                  </p>
                  <div className="pt-2">
                    <Label htmlFor="confirm-name" className="text-sm font-medium">
                      Type the organization name to confirm: <span className="font-bold">{organizations.find(o => o.id === deleteConfirmId)?.name}</span>
                    </Label>
                    <Input
                      id="confirm-name"
                      className="mt-1.5"
                      placeholder="Type organization name here"
                      value={deleteConfirmName}
                      onChange={(e) => setDeleteConfirmName(e.target.value)}
                    />
                  </div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setDeleteConfirmName('')}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
                disabled={
                  deleteMutation.isPending || 
                  deleteConfirmName !== organizations.find(o => o.id === deleteConfirmId)?.name
                }
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Permanently Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Layout>
  );
}