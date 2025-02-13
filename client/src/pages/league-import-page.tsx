import { useState } from "react";
import { useParams } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

export default function LeagueImportPage() {
  const { toast } = useToast();
  const params = useParams();
  const leagueId = parseInt(params.leagueId!);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const content = await file.text();
      const response = await apiRequest("POST", "/api/import/qubica", {
        leagueId,
        fileContent: content,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || "Failed to import file");
      }

      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Import successful",
        description: `Imported ${data.data.importedGames} games from week ${data.data.weekNumber}`,
      });
      setSelectedFile(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Import failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.name.toLowerCase().endsWith('.s00')) {
      setSelectedFile(file);
    } else {
      toast({
        title: "Invalid file",
        description: "Please select a valid QubicaAMF score file (.S00)",
        variant: "destructive",
      });
    }
  };

  const handleImport = () => {
    if (selectedFile) {
      importMutation.mutate(selectedFile);
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Import Scores</h1>
        <Card>
          <CardHeader>
            <CardTitle>Import QubicaAMF Scores</CardTitle>
            <CardDescription>
              Upload a .S00 file from QubicaAMF scoring system to import scores for this league
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <input
                  type="file"
                  accept=".S00,.s00"
                  onChange={handleFileChange}
                  className="hidden"
                  id="score-file"
                />
                <Button
                  variant="secondary"
                  onClick={() => document.getElementById("score-file")?.click()}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Select File
                </Button>
                {selectedFile && (
                  <span className="text-sm text-muted-foreground">
                    {selectedFile.name}
                  </span>
                )}
              </div>

              {selectedFile && (
                <Button
                  onClick={handleImport}
                  disabled={importMutation.isPending}
                >
                  {importMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Import Scores
                </Button>
              )}

              {importMutation.isSuccess && (
                <p className="text-sm text-green-600 dark:text-green-400">
                  Import completed successfully
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
