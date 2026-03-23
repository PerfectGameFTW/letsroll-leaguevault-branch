import { FC } from "react";
import { X, Check } from "lucide-react";
import type { League, BowlerLeague, Team } from "@shared/schema";

interface LeagueBottomSheetProps {
  open: boolean;
  onClose: () => void;
  activeBowlerLeagues: BowlerLeague[];
  leagueMap: Map<number, League>;
  teamMap: Map<number, Team>;
  selectedLeagueId: number | null;
  onSelectLeague: (leagueId: number) => void;
  totalWeeksMap?: Map<number, number>;
  currentWeekMap?: Map<number, number | null>;
}

export const LeagueBottomSheet: FC<LeagueBottomSheetProps> = ({
  open,
  onClose,
  activeBowlerLeagues,
  leagueMap,
  teamMap,
  selectedLeagueId,
  onSelectLeague,
  totalWeeksMap,
  currentWeekMap,
}) => {
  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-40 transition-opacity duration-300"
        onClick={onClose}
      />
      <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up">
        <div className="bg-white rounded-t-2xl shadow-xl max-h-[70vh] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h3 className="text-lg font-semibold text-slate-900">Switch League</h3>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="overflow-y-auto">
            {activeBowlerLeagues.map((bl) => {
              const league = leagueMap.get(bl.leagueId);
              const team = bl.teamId ? teamMap.get(bl.teamId) : undefined;
              const isSelected = bl.leagueId === selectedLeagueId;
              const totalWeeks = totalWeeksMap?.get(bl.leagueId);
              const currentWeek = currentWeekMap?.get(bl.leagueId);

              return (
                <button
                  key={bl.leagueId}
                  onClick={() => {
                    onSelectLeague(bl.leagueId);
                    onClose();
                  }}
                  className={`w-full text-left px-5 py-4 flex items-center justify-between transition-colors ${
                    isSelected ? 'bg-indigo-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <div>
                    <div className={`font-medium ${isSelected ? 'text-indigo-700' : 'text-slate-900'}`}>
                      {league?.name ?? `League #${bl.leagueId}`}
                    </div>
                    <div className="text-sm text-slate-500 mt-0.5">
                      {team?.name ?? 'No Team'}
                      {currentWeek != null && totalWeeks != null && (
                        <> &bull; Week {currentWeek} of {totalWeeks}</>
                      )}
                    </div>
                  </div>
                  {isSelected && (
                    <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0 ml-3">
                      <Check className="w-4 h-4 text-white" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="h-8" />
        </div>
      </div>

      <style>{`
        @keyframes slide-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
      `}</style>
    </>
  );
};
