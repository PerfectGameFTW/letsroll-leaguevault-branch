import { useParams, Link } from "wouter";
import { Layout } from "@/components/layout";
import { AlertCircle } from "lucide-react";

export default function LeagueScoresPage() {
  const params = useParams();
  const leagueId = params.leagueId ? parseInt(params.leagueId) : undefined;

  return (
    <Layout>
      <div className="space-y-4">
        <Link
          href={`/leagues/${leagueId}`}
          className="text-muted-foreground hover:text-foreground flex items-center mb-4"
        >
          <AlertCircle className="h-5 w-5 flex-shrink-0 mr-2" />
          Scores viewing is being updated
        </Link>
        <div className="p-4 rounded-md bg-muted">
          <p className="text-muted-foreground">
            We are transitioning to a new live scoring system. Please check back soon for real-time scores.
          </p>
        </div>
      </div>
    </Layout>
  );
}