import { FC } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import type { ApiResponse } from "@shared/schema";

const STALE_TIME = 1000 * 60 * 5;

// Task #735: render-on-demand toggle that fetches the caller's
// league_secretary grants and only paints a button when at least one
// grant exists. Side-effect-free (the same lookup is cached against
// queryKey ['/api/me/league-secretary-leagues'] on /my-leagues so
// switching surfaces is instant after the first hop).
export const SecretaryToggleButton: FC<{ enabled: boolean }> = ({ enabled }) => {
  const { data } = useQuery<ApiResponse<Array<{ id: number }>>>({
    queryKey: ['/api/me/league-secretary-leagues'],
    enabled,
    staleTime: STALE_TIME,
  });
  const grants = data?.data ?? [];
  if (!enabled || grants.length === 0) return null;
  return (
    <div className="mb-6">
      <Button asChild variant="outline" size="sm" data-testid="link-my-leagues">
        <Link href="/my-leagues">Switch to secretary view</Link>
      </Button>
    </div>
  );
};
