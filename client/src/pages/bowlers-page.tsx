import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout";
import { BowlerForm } from "@/components/bowler-form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus } from "lucide-react";
import type { Bowler } from "@shared/schema";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function BowlersPage() {
  const [showForm, setShowForm] = useState(false);
  const { toast } = useToast();

  const { data: bowlers, isLoading } = useQuery<Bowler[]>({
    queryKey: ["/api/bowlers"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/bowlers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bowlers"] });
      toast({
        title: "Bowler deleted",
        description: "The bowler has been removed from the system.",
      });
    },
  });

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Bowlers</h1>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Bowler
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Weekly Fee</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bowlers?.map((bowler) => (
              <TableRow key={bowler.id}>
                <TableCell>{bowler.name}</TableCell>
                <TableCell>{bowler.email}</TableCell>
                <TableCell>${(bowler.weeklyFee / 100).toFixed(2)}</TableCell>
                <TableCell>
                  <Badge variant={bowler.active ? "default" : "secondary"}>
                    {bowler.active ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteMutation.mutate(bowler.id)}
                  >
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <BowlerForm open={showForm} onClose={() => setShowForm(false)} />
    </Layout>
  );
}
