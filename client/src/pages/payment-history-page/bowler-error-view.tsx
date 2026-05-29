import { FC } from "react";
import { BowlerLayout } from "@/components/bowler-layout";

export const BowlerErrorView: FC = () => {
  return (
    <BowlerLayout bowlerName="Error" leagueName="Error">
      <div className="text-center text-destructive">
        Failed to load bowler information
      </div>
    </BowlerLayout>
  );
};
