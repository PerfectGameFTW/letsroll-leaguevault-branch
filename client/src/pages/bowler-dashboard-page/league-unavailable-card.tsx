import { FC } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export const LeagueUnavailableCard: FC<{ onRetry: () => void }> = ({ onRetry }) => {
  return (
    <Card className="mx-auto max-w-md mt-8">
      <CardHeader>
        <CardTitle>League Data Unavailable</CardTitle>
        <CardDescription>Unable to load league information</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground">
          Please try again later or contact support if the problem persists.
        </p>
        <Button variant="outline" onClick={onRetry} className="w-full flex items-center gap-2">
          <RefreshCw className="size-4" />
          Try Again
        </Button>
      </CardContent>
    </Card>
  );
};
