import { FC } from "react";
import { Link } from "wouter";
import { BowlerLayout } from "@/components/bowler-layout";

interface NoLeagueViewProps {
  bowlerName: string;
  bowlerId: number | null | undefined;
  leagueId: number | null | undefined;
}

export const NoLeagueView: FC<NoLeagueViewProps> = ({ bowlerName, bowlerId, leagueId }) => {
  return (
    <BowlerLayout bowlerName={bowlerName} leagueName="League not found">
      <div className="text-center space-y-4">
        <p>League information cannot be loaded for this bowler</p>
        <div className="text-left border p-4 rounded-md bg-muted/30">
          <p className="font-mono text-sm">BowlerId: {bowlerId}</p>
          <p className="font-mono text-sm">LeagueId: {leagueId}</p>
        </div>
        <Link href="/bowler-dashboard" className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-white">
          Return to Dashboard
        </Link>
      </div>
    </BowlerLayout>
  );
};
