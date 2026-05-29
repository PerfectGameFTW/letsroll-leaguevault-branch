import { FC } from "react";
import { Link } from "wouter";
import { BowlerLayout } from "@/components/bowler-layout";

interface NoLeaguesViewProps {
  bowlerName: string;
}

export const NoLeaguesView: FC<NoLeaguesViewProps> = ({ bowlerName }) => {
  return (
    <BowlerLayout bowlerName={bowlerName || 'Bowler'} leagueName="No League">
      <div className="text-center space-y-4">
        <p>You are not registered in any leagues</p>
        <Link href="/bowler-dashboard" className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-white">
          Return to Dashboard
        </Link>
      </div>
    </BowlerLayout>
  );
};
