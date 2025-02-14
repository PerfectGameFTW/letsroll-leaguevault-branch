import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Loader2, Users, DollarSign, Upload } from "lucide-react";
import type { League } from "@shared/schema";
import { useParams, Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export default function LeagueViewPage() {
  const params = useParams();
  const leagueId = parseInt(params.leagueId!);
  const { toast } = useToast();

  const { data: leagueResponse, isLoading } = useQuery<{ data: League }>({
    queryKey: [`/api/leagues/${leagueId}`],
  });

  const league = leagueResponse?.data;

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Check file extension
    if (!file.name.toLowerCase().endsWith('.s00')) {
      toast({
        title: "Invalid file type",
        description: "Please select a .S00 file from QubicaAMF scoring system",
        variant: "destructive",
      });
      return;
    }

    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please select a file smaller than 5MB",
        variant: "destructive",
      });
      return;
    }

    try {
      toast({
        title: "Uploading scores",
        description: "Please wait while we process your file...",
      });

      const reader = new FileReader();
      reader.onload = async (e) => {
        const content = e.target?.result;
        if (typeof content !== 'string') {
          throw new Error('Failed to read file content');
        }

        const response = await fetch(`/api/leagues/${leagueId}/import-scores`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fileContent: content }),
        });

        const data = await response.json();

        if (response.ok && data.success) {
          toast({
            title: "Scores imported successfully",
            description: `Created ${data.data.gamesCreated} games with ${data.data.scoresCreated} scores`,
          });

          // Clear the file input
          event.target.value = '';
        } else {
          throw new Error(data.error?.message || 'Failed to import scores');
        }
      };

      reader.onerror = () => {
        throw new Error('Failed to read file');
      };

      reader.readAsText(file);
    } catch (error) {
      toast({
        title: "Error importing scores",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });

      // Clear the file input on error
      event.target.value = '';
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  if (!league) {
    return (
      <Layout>
        <div className="text-center">League not found</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{league.name}</h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Link href={`/leagues/${leagueId}/teams`} className="block">
            <Card className="hover:bg-accent transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Users className="h-5 w-5 mr-2" />
                  Roster Management
                </CardTitle>
                <CardDescription>
                  Manage bowlers and teams in your league
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Add or remove bowlers, organize team rosters, and manage team assignments
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href={`/leagues/${leagueId}/weekly-payments`} className="block">
            <Card className="hover:bg-accent transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center">
                  <DollarSign className="h-5 w-5 mr-2" />
                  Weekly Payments
                </CardTitle>
                <CardDescription>
                  Log and track weekly cash/check payments
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Record manual payments by team and week, view payment history
                </p>
              </CardContent>
            </Card>
          </Link>

          {/* Score Import Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Upload className="h-5 w-5 mr-2" />
                Import Scores
              </CardTitle>
              <CardDescription>
                Upload scores from QubicaAMF .S00 files
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Import bowling scores directly from your QubicaAMF scoring system export files
              </p>
              <div className="flex items-center gap-2">
                <Input
                  type="file"
                  accept=".S00,.s00"
                  onChange={handleFileUpload}
                  className="cursor-pointer"
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}