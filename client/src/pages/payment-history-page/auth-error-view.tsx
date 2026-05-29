import { FC } from "react";
import { Link } from "wouter";
import { BowlerLayout } from "@/components/bowler-layout";
import { PageErrorState } from "@/components/page-states";

export const AuthErrorView: FC = () => {
  return (
    <BowlerLayout bowlerName="Authentication Error" leagueName="Error">
      <PageErrorState message="Please log in to view payment history" />
      <div className="text-center mt-4">
        <Link href="/login" className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-white">
          Log In
        </Link>
      </div>
    </BowlerLayout>
  );
};
