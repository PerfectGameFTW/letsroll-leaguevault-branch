import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Edit, Trash, Archive, RotateCcw, AlertTriangle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Location } from "@shared/schema";
import { Layout } from "@/components/layout";

export default function LocationsPage() {
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [phone, setPhone] = useState("");

  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [archiveConfirmId, setArchiveConfirmId] = useState<number | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ success: boolean; data: Location[] }>({
    queryKey: ["/api/locations"],
  });

  const createMutation = useMutation({
    mutationFn: async (loc: { name: string; address?: string; city?: string; state?: string; zipCode?: string; phone?: string }) => {
      return apiRequest("/api/locations", "POST", loc);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Location Created", description: "The location has been successfully created." });
      resetForm();
      setOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: `Failed to create location: ${error.message}`, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, loc }: { id: number; loc: Record<string, any> }) => {
      return apiRequest(`/api/locations/${id}`, "PATCH", loc);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Location Updated", description: "The location has been successfully updated." });
      resetForm();
      setOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: `Failed to update location: ${error.message}`, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/locations/${id}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Location Deleted", description: "The location and all its data have been permanently deleted." });
      setDeleteConfirmId(null);
      setDeleteConfirmName("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: `Failed to delete location: ${error.message}`, variant: "destructive" });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/locations/${id}/archive`, "PATCH");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Location Archived", description: "The location has been archived and hidden from normal views." });
      setArchiveConfirmId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: `Failed to archive location: ${error.message}`, variant: "destructive" });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/locations/${id}/restore`, "PATCH");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Location Restored", description: "The location has been restored and is now active again." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: `Failed to restore location: ${error.message}`, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setName("");
    setAddress("");
    setCity("");
    setState("");
    setZipCode("");
    setPhone("");
    setEditId(null);
  };

  const handleEditClick = (loc: Location) => {
    setEditId(loc.id);
    setName(loc.name);
    setAddress(loc.address || "");
    setCity(loc.city || "");
    setState(loc.state || "");
    setZipCode(loc.zipCode || "");
    setPhone(loc.phone || "");
    setOpen(true);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const locData = { name, address, city, state, zipCode, phone };

    if (editId) {
      updateMutation.mutate({ id: editId, loc: locData });
    } else {
      createMutation.mutate(locData);
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  const allLocations = data?.data || [];
  const locations = showArchived ? allLocations : allLocations.filter((l) => l.active !== false);
  const archivedCount = allLocations.filter((l) => l.active === false).length;

  return (
    <Layout>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Locations</h1>
        <Button onClick={() => { resetForm(); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          Add Location
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Locations</CardTitle>
              <CardDescription>Manage bowling locations for your organization</CardDescription>
            </div>
            {archivedCount > 0 && (
              <div className="flex items-center gap-2">
                <Label htmlFor="show-archived-locations" className="text-sm text-muted-foreground cursor-pointer">
                  Show archived ({archivedCount})
                </Label>
                <Switch
                  id="show-archived-locations"
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
                <TableHead>Address</TableHead>
                <TableHead>City</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center">
                    No locations found
                  </TableCell>
                </TableRow>
              ) : (
                locations.map((loc) => (
                  <TableRow key={loc.id} className={loc.active === false ? "opacity-60" : ""}>
                    <TableCell className="font-medium">{loc.name}</TableCell>
                    <TableCell>{loc.address || "—"}</TableCell>
                    <TableCell>{loc.city || "—"}</TableCell>
                    <TableCell>{loc.state || "—"}</TableCell>
                    <TableCell>{loc.phone || "—"}</TableCell>
                    <TableCell>
                      {loc.active === false ? (
                        <Badge variant="secondary">Archived</Badge>
                      ) : (
                        <Badge variant="default">Active</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex space-x-2">
                        <Button variant="outline" size="sm" onClick={() => handleEditClick(loc)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        {loc.active === false ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => restoreMutation.mutate(loc.id)}
                            disabled={restoreMutation.isPending}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setArchiveConfirmId(loc.id)}
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setDeleteConfirmId(loc.id)}
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[525px]">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Location" : "Add Location"}</DialogTitle>
            <DialogDescription>
              {editId ? "Update the location details below." : "Add a new bowling location to your organization."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleFormSubmit}>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="loc-name" className="text-right">Name</Label>
                <Input
                  id="loc-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="loc-address" className="text-right">Address</Label>
                <Input
                  id="loc-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="loc-city" className="text-right">City</Label>
                <Input
                  id="loc-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="loc-state" className="text-right">State</Label>
                <Input
                  id="loc-state"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="loc-zip" className="text-right">Zip Code</Label>
                <Input
                  id="loc-zip"
                  value={zipCode}
                  onChange={(e) => setZipCode(e.target.value)}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="loc-phone" className="text-right">Phone</Label>
                <Input
                  id="loc-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="col-span-3"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {createMutation.isPending || updateMutation.isPending
                  ? "Saving..."
                  : editId
                  ? "Update Location"
                  : "Create Location"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!archiveConfirmId} onOpenChange={(open) => { if (!open) setArchiveConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Location</AlertDialogTitle>
            <AlertDialogDescription>
              This will hide the location from normal views. The location and all its data will be preserved and can be restored at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => archiveConfirmId && archiveMutation.mutate(archiveConfirmId)}
              disabled={archiveMutation.isPending}
            >
              {archiveMutation.isPending ? "Archiving..." : "Archive Location"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) { setDeleteConfirmId(null); setDeleteConfirmName(""); } }}>
        <AlertDialogContent className="max-h-[90vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Permanently Delete Location
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p className="font-semibold text-destructive">
                  This action is irreversible and cannot be undone.
                </p>
                <p>
                  Permanently deleting this location will:
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Remove the location from all associated leagues</li>
                  <li>Permanently delete the location record</li>
                </ul>
                <p className="text-sm">
                  Consider archiving instead if you may need this data in the future.
                </p>
                <div className="pt-2">
                  <Label htmlFor="confirm-location-name" className="text-sm font-medium">
                    Type the location name to confirm: <span className="font-bold">{allLocations.find((l) => l.id === deleteConfirmId)?.name}</span>
                  </Label>
                  <Input
                    id="confirm-location-name"
                    className="mt-1.5"
                    placeholder="Type location name here"
                    value={deleteConfirmName}
                    onChange={(e) => setDeleteConfirmName(e.target.value)}
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConfirmName("")}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
              disabled={
                deleteMutation.isPending ||
                deleteConfirmName !== allLocations.find((l) => l.id === deleteConfirmId)?.name
              }
            >
              {deleteMutation.isPending ? "Deleting..." : "Permanently Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}