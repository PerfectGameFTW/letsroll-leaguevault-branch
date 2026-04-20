import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Location } from "@shared/schema";

interface Props {
  open: boolean;
  onClose: () => void;
  location: Location | null;
}

export function LocationFormDialog({ open, onClose, location }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    if (open) {
      setName(location?.name ?? "");
      setAddress(location?.address ?? "");
      setCity(location?.city ?? "");
      setState(location?.state ?? "");
      setZipCode(location?.zipCode ?? "");
      setPhone(location?.phone ?? "");
    }
  }, [open, location]);

  const createMutation = useMutation({
    mutationFn: async (loc: Record<string, any>) => apiRequest("/api/locations", "POST", loc),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Location Created", description: "The location has been successfully created." });
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: `Failed to create location: ${error.message}`, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, loc }: { id: number; loc: Record<string, any> }) =>
      apiRequest(`/api/locations/${id}`, "PATCH", loc),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Location Updated", description: "The location has been successfully updated." });
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: `Failed to update location: ${error.message}`, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const locData = { name, address, city, state, zipCode, phone };
    if (location) {
      updateMutation.mutate({ id: location.id, loc: locData });
    } else {
      createMutation.mutate(locData);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>{location ? "Edit Location" : "Add Location"}</DialogTitle>
          <DialogDescription>
            {location ? "Update the location details below." : "Add a new bowling location to your organization."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            {[
              { id: "loc-name", label: "Name", value: name, set: setName, required: true },
              { id: "loc-address", label: "Address", value: address, set: setAddress },
              { id: "loc-city", label: "City", value: city, set: setCity },
              { id: "loc-state", label: "State", value: state, set: setState },
              { id: "loc-zip", label: "Zip Code", value: zipCode, set: setZipCode },
              { id: "loc-phone", label: "Phone", value: phone, set: setPhone },
            ].map((f) => (
              <div key={f.id} className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor={f.id} className="text-right">{f.label}</Label>
                <Input
                  id={f.id}
                  required={f.required}
                  value={f.value}
                  onChange={(e) => f.set(e.target.value)}
                  className="col-span-3"
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : location ? "Update Location" : "Create Location"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
