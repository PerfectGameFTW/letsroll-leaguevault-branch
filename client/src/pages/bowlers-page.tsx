import { useState } from "react";
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
import { Loader2, Plus, Eye, EyeOff, Search } from "lucide-react";
import type { Bowler } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { useBowlers } from "@/hooks/use-bowlers";

// Loading skeleton component
function BowlerTableSkeleton() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>League Name</TableHead>
          <TableHead>Team Name</TableHead>
          <TableHead>Square Customer ID</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {[...Array(5)].map((_, i) => (
          <TableRow key={i}>
            <TableCell>
              <div className="h-4 w-32 bg-muted animate-pulse rounded" />
            </TableCell>
            <TableCell>
              <div className="h-4 w-32 bg-muted animate-pulse rounded" />
            </TableCell>
            <TableCell>
              <div className="h-4 w-32 bg-muted animate-pulse rounded" />
            </TableCell>
            <TableCell>
              <div className="h-4 w-24 bg-muted animate-pulse rounded" />
            </TableCell>
            <TableCell>
              <div className="h-4 w-32 bg-muted animate-pulse rounded" />
            </TableCell>
            <TableCell>
              <div className="h-6 w-16 bg-muted animate-pulse rounded-full" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function BowlersPage() {
  const [showForm, setShowForm] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();

  const {
    bowlers: filteredBowlers,
    getBowlerFirstLeagueName,
    getBowlerTeamName,
    isInitialLoading,
    isLoadingRelatedData
  } = useBowlers({
    showInactive,
    searchQuery
  });

  return (
    <Layout>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Bowlers</h1>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Bowler
        </Button>
      </div>

      <div className="space-y-4 mb-6">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search bowlers..."
            value={searchQuery}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex items-center space-x-2">
          {showInactive ? (
            <Eye className="h-4 w-4 text-muted-foreground" />
          ) : (
            <EyeOff className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-sm text-muted-foreground">Show inactive bowlers</span>
          <Switch
            checked={showInactive}
            onCheckedChange={setShowInactive}
          />
        </div>
      </div>

      <div className="rounded-md border">
        {isInitialLoading ? (
          <BowlerTableSkeleton />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>League Name</TableHead>
                <TableHead>Team Name</TableHead>
                <TableHead>Square Customer ID</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredBowlers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-4">
                    {isLoadingRelatedData ? (
                      <div className="flex items-center justify-center">
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Loading bowler details...
                      </div>
                    ) : (
                      "No bowlers found"
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                filteredBowlers.map((bowler) => {
                  const leagueName = getBowlerFirstLeagueName(bowler);
                  const teamName = getBowlerTeamName(bowler);
                  return (
                    <TableRow key={bowler.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <Link
                            href={`/bowlers/${bowler.id}`}
                            className="hover:underline text-foreground block"
                          >
                            {bowler.name}
                          </Link>
                        </div>
                      </TableCell>
                      <TableCell>
                        {isLoadingRelatedData ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          leagueName
                        )}
                      </TableCell>
                      <TableCell>
                        {isLoadingRelatedData ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          teamName
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {bowler.squareCustomerId || '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={bowler.active ? "default" : "secondary"}>
                          {bowler.active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        )}
      </div>

      <BowlerForm
        open={showForm}
        onClose={() => {
          setShowForm(false);
        }}
      />
    </Layout>
  );
}