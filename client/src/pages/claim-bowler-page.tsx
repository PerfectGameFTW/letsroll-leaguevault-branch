import { FC, useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, User, ChevronRight, SkipForward } from "lucide-react";
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

interface UnlinkedBowler {
  id: number;
  name: string;
}

interface TeamGroup {
  team: { id: number; name: string; number: number };
  bowlers: UnlinkedBowler[];
}

interface LeagueGroup {
  league: { id: number; name: string };
  teams: TeamGroup[];
}

const ClaimBowlerPage: FC = () => {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedBowler, setSelectedBowler] = useState<UnlinkedBowler | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const organizationId = useMemo(() => {
    const params = new URLSearchParams(searchString);
    return params.get("organizationId") || null;
  }, [searchString]);

  const unlinkedUrl = organizationId
    ? `/api/bowlers/unlinked?organizationId=${organizationId}`
    : "/api/bowlers/unlinked";

  const { data: unlinkedResponse, isLoading } = useQuery<{ success: boolean; data: LeagueGroup[] }>({
    queryKey: ["/api/bowlers/unlinked", organizationId],
    queryFn: async () => {
      const res = await fetch(unlinkedUrl);
      if (!res.ok) throw new Error("Failed to fetch unlinked bowlers");
      return res.json();
    },
  });

  const unlinkedData = unlinkedResponse?.data ?? [];

  const claimMutation = useMutation({
    mutationFn: async (bowlerId: number) => {
      return apiRequest("/api/auth/claim-bowler", "POST", { bowlerId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bowlers/unlinked"] });
      toast({
        title: "Success!",
        description: "Your account has been linked to your bowler profile.",
      });
      setLocation("/bowler-dashboard");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to claim bowler profile.",
        variant: "destructive",
      });
    },
  });

  const filteredData = useMemo(() => {
    if (!searchQuery.trim()) return unlinkedData;

    const query = searchQuery.toLowerCase();
    return unlinkedData
      .map((leagueGroup) => ({
        ...leagueGroup,
        teams: leagueGroup.teams
          .map((teamGroup) => ({
            ...teamGroup,
            bowlers: teamGroup.bowlers.filter((b) =>
              b.name.toLowerCase().includes(query)
            ),
          }))
          .filter((tg) => tg.bowlers.length > 0),
      }))
      .filter((lg) => lg.teams.length > 0);
  }, [unlinkedData, searchQuery]);

  const totalBowlers = useMemo(() => {
    return unlinkedData.reduce(
      (sum, lg) => sum + lg.teams.reduce((tSum, tg) => tSum + tg.bowlers.length, 0),
      0
    );
  }, [unlinkedData]);

  const handleSelectBowler = (bowler: UnlinkedBowler) => {
    setSelectedBowler(bowler);
    setConfirmOpen(true);
  };

  const handleConfirmClaim = () => {
    if (selectedBowler) {
      claimMutation.mutate(selectedBowler.id);
    }
    setConfirmOpen(false);
  };

  const handleSkip = () => {
    setLocation("/bowler-dashboard");
  };

  return (
    <div className="min-h-screen bg-background flex items-start sm:items-center justify-center p-4 pt-6 sm:pt-4">
      <Card className="w-full max-w-lg mt-4 sm:mt-0">
        <CardHeader className="space-y-1 pb-4">
          <CardTitle className="text-2xl font-bold text-center">
            Find Your Name on the Roster
          </CardTitle>
          <CardDescription className="text-center">
            Select your name from the league roster below to link your account to your bowler profile.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : totalBowlers === 0 ? (
            <div className="text-center py-8 space-y-4">
              <p className="text-muted-foreground">
                No unlinked bowler profiles are available right now.
              </p>
              <Button onClick={handleSkip} className="w-full">
                Continue to Dashboard
              </Button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              <div className="max-h-[400px] overflow-y-auto space-y-4 pr-1">
                {filteredData.length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">
                    No bowlers match your search.
                  </p>
                ) : (
                  filteredData.map((leagueGroup) => (
                    <div key={leagueGroup.league.id} className="space-y-2">
                      <h3 className="font-semibold text-sm text-primary">
                        {leagueGroup.league.name}
                      </h3>
                      {leagueGroup.teams.map((teamGroup) => (
                        <div key={teamGroup.team.id} className="space-y-1 ml-2">
                          <p className="text-xs text-muted-foreground font-medium">
                            Team {teamGroup.team.number} — {teamGroup.team.name}
                          </p>
                          {teamGroup.bowlers.map((bowler) => (
                            <button
                              key={bowler.id}
                              onClick={() => handleSelectBowler(bowler)}
                              className="w-full flex items-center justify-between p-2 rounded-md hover:bg-accent transition-colors text-left group"
                              disabled={claimMutation.isPending}
                            >
                              <div className="flex items-center gap-2">
                                <User className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm">{bowler.name}</span>
                              </div>
                              <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>

              <div className="pt-2 border-t">
                <Button
                  variant="ghost"
                  onClick={handleSkip}
                  className="w-full text-muted-foreground"
                  disabled={claimMutation.isPending}
                >
                  <SkipForward className="h-4 w-4 mr-2" />
                  Skip — I'm not on a roster yet
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Your Identity</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you are <strong>{selectedBowler?.name}</strong>? This will link your account to this bowler profile.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmClaim} disabled={claimMutation.isPending}>
              {claimMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Linking...
                </>
              ) : (
                "Yes, that's me"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ClaimBowlerPage;
