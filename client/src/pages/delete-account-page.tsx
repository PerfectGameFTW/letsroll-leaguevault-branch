import { FC, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Trash2, Loader2, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const DeleteAccountPage: FC = () => {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      setLocation("/login");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      toast({
        title: "Email required",
        description: "Please enter the email address associated with your account.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/account/request-deletion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), reason: reason.trim() }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || "Failed to submit request");
      }

      setIsSubmitted(true);
    } catch (error) {
      toast({
        title: "Request submitted",
        description: "If an account exists with this email, your deletion request has been recorded.",
        variant: "default",
      });
      setIsSubmitted(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-background flex items-start sm:items-center justify-center p-4 pt-6 sm:pt-4">
        <Card className="w-full max-w-md mt-4 sm:mt-0">
          <CardHeader className="text-center space-y-2">
            <div className="flex justify-center">
              <CheckCircle className="h-12 w-12 text-green-500" />
            </div>
            <CardTitle className="text-xl">Request Received</CardTitle>
            <CardDescription>
              Your account deletion request has been submitted. If an account exists with the provided email, we will process your request within 30 days. You will receive a confirmation email once your account and associated data have been deleted.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button variant="outline" onClick={() => setLocation("/login")}>
              Return to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-start sm:items-center justify-center p-4 pt-6 sm:pt-4">
      <Card className="w-full max-w-md mt-4 sm:mt-0">
        <CardHeader className="space-y-1 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <Button variant="ghost" size="sm" className="gap-1" onClick={handleBack}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </div>
          <CardTitle className="text-xl font-bold flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-destructive" />
            Request Account Deletion
          </CardTitle>
          <CardDescription>
            Submit a request to permanently delete your LeagueVault account and all associated data. This action cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="Enter your account email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Enter the email address associated with your account.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reason">Reason (optional)</Label>
              <Textarea
                id="reason"
                placeholder="Let us know why you'd like to delete your account"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
              />
            </div>

            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <p className="font-medium mb-1">What will be deleted:</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>Your user account and login credentials</li>
                <li>Profile information and avatar</li>
                <li>Payment history and saved cards</li>
                <li>Bowler profile linkage</li>
              </ul>
            </div>

            <Button
              type="submit"
              variant="destructive"
              className="w-full"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Submitting...
                </>
              ) : (
                "Submit Deletion Request"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default DeleteAccountPage;
