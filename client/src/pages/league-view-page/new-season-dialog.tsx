import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, RefreshCw } from "lucide-react";
import type { League } from "@shared/schema";
import { getSeasonLabel } from "@shared/season-utils";

export function NewSeasonDialog({
  league,
  showNewSeason,
  setShowNewSeason,
  newSeasonStart,
  setNewSeasonStart,
  newSeasonEnd,
  setNewSeasonEnd,
  onCreate,
  isPending,
}: {
  league: League;
  showNewSeason: boolean;
  setShowNewSeason: (v: boolean) => void;
  newSeasonStart: string;
  setNewSeasonStart: (v: string) => void;
  newSeasonEnd: string;
  setNewSeasonEnd: (v: string) => void;
  onCreate: () => void;
  isPending: boolean;
}) {
  return (
    <Dialog open={showNewSeason} onOpenChange={(open) => { if (!open) { setShowNewSeason(false); setNewSeasonStart(""); setNewSeasonEnd(""); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start New Season</DialogTitle>
          <DialogDescription>
            Create a new season of <strong>{league.name}</strong> with the same teams and bowlers. The current season will be archived and remain accessible in the season history.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label htmlFor="new-season-start" className="text-sm font-medium">New Season Start Date</label>
            <Input
              id="new-season-start"
              type="date"
              value={newSeasonStart}
              onChange={(e) => setNewSeasonStart(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <label htmlFor="new-season-end" className="text-sm font-medium">New Season End Date</label>
            <Input
              id="new-season-end"
              type="date"
              value={newSeasonEnd}
              onChange={(e) => setNewSeasonEnd(e.target.value)}
              className="mt-1"
            />
          </div>
          {newSeasonStart && newSeasonEnd && new Date(newSeasonEnd) > new Date(newSeasonStart) && (
            <p className="text-sm text-muted-foreground">
              This will create the <strong>{getSeasonLabel(newSeasonStart, newSeasonEnd)}</strong>
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setShowNewSeason(false); setNewSeasonStart(""); setNewSeasonEnd(""); }}>
            Cancel
          </Button>
          <Button
            onClick={onCreate}
            disabled={!newSeasonStart || !newSeasonEnd || isPending}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="size-4 mr-2" />
            )}
            Create New Season
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
