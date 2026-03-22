import { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import type { Organization, InsertOrganization } from '@shared/schema';

interface OrganizationFormDialogProps {
  open: boolean;
  onClose: () => void;
  editOrg?: Organization | null;
}

export function OrganizationFormDialog({ open, onClose, editOrg }: OrganizationFormDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editId = editOrg?.id ?? null;

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
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPhone, setAdminPhone] = useState('');

  useEffect(() => {
    if (open) {
      setName(editOrg?.name ?? '');
      setSlug(editOrg?.slug ?? '');
      setAddress(editOrg?.address ?? '');
      setCity(editOrg?.city ?? '');
      setState(editOrg?.state ?? '');
      setZipCode(editOrg?.zipCode ?? '');
      setPhone(editOrg?.phone ?? '');
      setEmail(editOrg?.email ?? '');
      setLogo(editOrg?.logo ?? null);
      setLogoPreview(editOrg?.logo ?? null);
      setAdminName('');
      setAdminEmail('');
      setAdminPhone('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [open, editOrg]);

  const createMutation = useMutation<any, Error, InsertOrganization, unknown>({
    mutationFn: async (org: InsertOrganization) => {
      return apiRequest('/api/organizations', 'POST', org);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/organizations'] });
      toast({ title: 'Organization Created', description: 'The organization has been successfully created.' });
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: `Failed to create organization: ${error.message}`, variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, org }: { id: number; org: Partial<InsertOrganization> }) => {
      return apiRequest(`/api/organizations/${id}`, 'PATCH', org);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/organizations'] });
      toast({ title: 'Organization Updated', description: 'The organization has been successfully updated.' });
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: `Failed to update organization: ${error.message}`, variant: 'destructive' });
    },
  });

  const generateSlug = () => {
    if (!name) return;
    const newSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    setSlug(newSlug);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!editId) {
      if (!adminName || !adminEmail) {
        toast({ title: 'Missing Administrator Information', description: 'Please fill out all required administrator fields.', variant: 'destructive' });
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(adminEmail)) {
        toast({ title: 'Invalid Email', description: 'Please enter a valid email address for the administrator.', variant: 'destructive' });
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
      logo: logo || undefined,
    };

    if (editId) {
      updateMutation.mutate({ id: editId, org: orgData });
    } else {
      const adminData = { name: adminName, email: adminEmail, phone: adminPhone || null };
      const dataToSend = { ...orgData, active: true, adminData };
      createMutation.mutate(dataToSend as unknown as InsertOrganization);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[525px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editId ? 'Edit Organization' : 'Create Organization'}</DialogTitle>
          <DialogDescription>
            {editId
              ? 'Update the organization details below.'
              : 'Add a new organization to the system with an administrator account.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleFormSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">Name</Label>
              <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} onBlur={generateSlug} className="col-span-3" />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="slug" className="text-right">Slug</Label>
              <Input id="slug" required value={slug} onChange={(e) => setSlug(e.target.value)} className="col-span-3" placeholder="org-name" />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="phone" className="text-right">Phone</Label>
              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="col-span-3" />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="email" className="text-right">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="col-span-3" />
            </div>

            {!editId && (
              <>
                <div className="mt-4 mb-2">
                  <h3 className="text-lg font-medium">Administrator Account</h3>
                  <p className="text-sm text-muted-foreground">
                    An invite email will be sent to the administrator to set up their password.
                  </p>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="adminName" className="text-right">Admin Name</Label>
                  <Input id="adminName" value={adminName} onChange={(e) => setAdminName(e.target.value)} className="col-span-3" required={!editId} />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="adminEmail" className="text-right">Admin Email</Label>
                  <Input id="adminEmail" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} className="col-span-3" required={!editId} />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="adminPhone" className="text-right">Admin Phone</Label>
                  <Input id="adminPhone" value={adminPhone} onChange={(e) => setAdminPhone(e.target.value)} className="col-span-3" />
                </div>
              </>
            )}

            <div className="mt-4 mb-2">
              <h3 className="text-lg font-medium">Organization Details</h3>
              <p className="text-sm text-muted-foreground">Additional organization information</p>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="address" className="text-right">Address</Label>
              <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} className="col-span-3" />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="city" className="text-right">City</Label>
              <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} className="col-span-3" />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="state" className="text-right">State</Label>
              <Input id="state" value={state} onChange={(e) => setState(e.target.value)} className="col-span-3" />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="zipCode" className="text-right">ZIP Code</Label>
              <Input id="zipCode" value={zipCode} onChange={(e) => setZipCode(e.target.value)} className="col-span-3" />
            </div>

            <div className="grid grid-cols-4 items-start gap-4 mt-4">
              <Label htmlFor="logo" className="text-right pt-2">Logo</Label>
              <div className="col-span-3 space-y-2">
                {logoPreview ? (
                  <div className="relative w-40 h-40 rounded-md overflow-hidden border">
                    <img src={logoPreview} alt="Organization logo" className="w-full h-full object-contain" />
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      className="absolute top-1 right-1 h-6 w-6 rounded-full"
                      onClick={() => {
                        setLogo(null);
                        setLogoPreview(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
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
                          if (file.size > 2 * 1024 * 1024) {
                            toast({ title: "File too large", description: "The logo file must be less than 2MB.", variant: "destructive" });
                            return;
                          }
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
                    <p className="text-xs text-muted-foreground mt-1">Upload your organization logo (PNG, JPG, SVG - max 2MB).</p>
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
              {editId ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
