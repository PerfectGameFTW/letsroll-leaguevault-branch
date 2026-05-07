import { FC } from "react";
import { Link } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, MailCheck } from "lucide-react";

/**
 * Task #667: registration landing for self-registered users that the
 * server couldn't auto-link to a bowler AND for whom no unlinked-bowler
 * candidates exist on the org's roster. The previous flow dropped these
 * users on /claim-bowler with an empty list, which read like a bug.
 *
 * This page tells them their account is created and that an admin will
 * finish setting them up. Admins triage the queue at
 * /admin/unclaimed-users (Task #667 server routes).
 */
const RegistrationCompletePage: FC = () => {
  return (
    <ErrorBoundary level="section">
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-2">
            <div className="flex justify-center">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
            </div>
            <CardTitle className="text-2xl font-bold">Account Created</CardTitle>
            <CardDescription>
              Thanks for signing up. Your account is ready to use.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border bg-muted/40 p-4 flex items-start gap-3">
              <MailCheck className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <div className="text-sm space-y-1">
                <p className="font-medium">A league admin will finish your setup</p>
                <p className="text-muted-foreground">
                  We couldn&apos;t automatically match your name to a roster
                  slot. An admin will assign you to a team and email you when
                  your bowler profile is ready.
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              You can sign in any time — your dashboard will appear once an
              admin links your bowler profile.
            </p>
          </CardContent>
          <CardFooter className="flex flex-col gap-2">
            <Button asChild className="w-full">
              <Link href="/login">Go to Sign In</Link>
            </Button>
            <Button asChild variant="ghost" className="w-full">
              <Link href="/profile">View Profile</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </ErrorBoundary>
  );
};

export default RegistrationCompletePage;
