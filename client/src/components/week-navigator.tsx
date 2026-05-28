import { ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Props {
  selectedWeek: number | null;
  maxWeek: number;
  selectedDate?: Date;
  onWeekChange: (week: number) => void;
  popoverOpen: boolean;
  onPopoverOpenChange: (open: boolean) => void;
}

export function WeekNavigator({
  selectedWeek,
  maxWeek,
  selectedDate,
  onWeekChange,
  popoverOpen,
  onPopoverOpenChange,
}: Props) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="size-9"
          onClick={() => onWeekChange(Math.max(1, (selectedWeek ?? 1) - 1))}
          disabled={selectedWeek === null || selectedWeek <= 1}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Popover open={popoverOpen} onOpenChange={onPopoverOpenChange}>
          <PopoverTrigger asChild>
            <Button variant="ghost" className="min-w-[100px] text-center font-medium text-sm px-2 h-9">
              {selectedWeek !== null ? `Week ${selectedWeek}` : "—"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3" align="center">
            <p className="text-xs font-medium text-muted-foreground mb-2 text-center">Jump to week</p>
            <div className="grid grid-cols-3 md:grid-cols-5 gap-1.5">
              {Array.from({ length: maxWeek }, (_, i) => i + 1).map((week) => (
                <Button
                  key={week}
                  variant={week === selectedWeek ? "default" : "ghost"}
                  size="sm"
                  className={cn("h-8 w-10 text-xs", week === selectedWeek && "pointer-events-none")}
                  onClick={() => {
                    onWeekChange(week);
                    onPopoverOpenChange(false);
                  }}
                >
                  {week}
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <Button
          variant="outline"
          size="icon"
          className="size-9"
          onClick={() => onWeekChange(Math.min(maxWeek, (selectedWeek ?? 1) + 1))}
          disabled={selectedWeek === null || selectedWeek >= maxWeek}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      {selectedDate && (
        <span className="text-sm text-muted-foreground">{format(selectedDate, "MMM d, yyyy")}</span>
      )}
    </div>
  );
}
