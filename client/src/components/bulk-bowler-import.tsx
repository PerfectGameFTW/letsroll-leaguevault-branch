import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { csrfFetch } from "@/lib/queryClient";
import {
  Upload,
  FileSpreadsheet,
  Download,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Plus,
} from "lucide-react";

interface PreviewRow {
  rowNumber: number;
  leagueName: string;
  teamName: string;
  teamNumber: number;
  bowlerName: string;
  email: string;
  phone: string;
  status: "valid" | "error" | "duplicate";
  errors: string[];
  isNewTeam?: boolean;
}

interface PreviewResult {
  preview: true;
  totalRows: number;
  validRows: number;
  errorRows: number;
  duplicateRows: number;
  leaguesMatched: number;
  newTeamsToCreate: number;
  rows: PreviewRow[];
}

interface ImportResult {
  bowlersCreated: number;
  teamsCreated: number;
  rowsSkipped: number;
  totalRows: number;
  createdTeamNames: string[];
  skippedDetails: { rowNumber: number; reason: string }[];
}

interface BulkBowlerImportProps {
  open: boolean;
  onClose: () => void;
}

type Step = "upload" | "preview" | "result";

export function BulkBowlerImport({ open, onClose }: BulkBowlerImportProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const resetState = useCallback(() => {
    setStep("upload");
    setSelectedFile(null);
    setPreviewData(null);
    setImportResult(null);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [onClose, resetState]);

  const previewMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await csrfFetch("/api/bowlers/bulk-import?preview=true", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        let msg = "Failed to preview file";
        try {
          const data = await res.json();
          msg = data.error?.message || data.message || msg;
        } catch {}
        throw new Error(msg);
      }
      const json = await res.json();
      return json.data as PreviewResult;
    },
    onSuccess: (data) => {
      setPreviewData(data);
      setStep("preview");
    },
    onError: (error: Error) => {
      toast({
        title: "Error previewing file",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await csrfFetch("/api/bowlers/bulk-import", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        let msg = "Failed to import bowlers";
        try {
          const data = await res.json();
          msg = data.error?.message || data.message || msg;
        } catch {}
        throw new Error(msg);
      }
      const json = await res.json();
      return json.data as ImportResult;
    },
    onSuccess: (data) => {
      setImportResult(data);
      setStep("result");
      queryClient.invalidateQueries({ queryKey: ["/api/bowlers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bowler-leagues"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Import failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handlePreview = () => {
    if (selectedFile) {
      previewMutation.mutate(selectedFile);
    }
  };

  const handleImport = () => {
    if (selectedFile) {
      importMutation.mutate(selectedFile);
    }
  };

  const handleDownloadTemplate = () => {
    window.open("/api/bowlers/bulk-import/template", "_blank");
  };

  const handleDownloadErrorReport = () => {
    if (!importResult?.skippedDetails.length) return;
    const lines = ["Row Number,Reason"];
    for (const detail of importResult.skippedDetails) {
      lines.push(`${detail.rowNumber},"${detail.reason.replace(/"/g, '""')}"`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "import-errors.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5" />
            {step === "upload" && "Import Bowlers"}
            {step === "preview" && "Preview Import"}
            {step === "result" && "Import Complete"}
          </DialogTitle>
          <DialogDescription>
            {step === "upload" &&
              "Upload a CSV or Excel file to import bowlers across your leagues. Teams will be created automatically."}
            {step === "preview" &&
              "Review the data below before confirming the import."}
            {step === "result" && "Here's a summary of the import."}
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-6 py-4">
            <div className="border-2 border-dashed rounded-lg p-8 text-center space-y-4">
              <Upload className="size-10 mx-auto text-muted-foreground" />
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Upload a CSV or XLSX file with bowler information
                </p>
                <input
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={handleFileChange}
                  className="hidden"
                  id="bulk-import-file"
                />
                <Button
                  variant="outline"
                  onClick={() =>
                    document.getElementById("bulk-import-file")?.click()
                  }
                >
                  Choose File
                </Button>
                {selectedFile && (
                  <p className="text-sm font-medium">{selectedFile.name}</p>
                )}
              </div>
            </div>

            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <p className="text-sm font-medium">Expected columns:</p>
              <div className="flex flex-wrap gap-2">
                {[
                  "League Name",
                  "Team Name",
                  "Team Number",
                  "Bowler Name",
                  "Email (optional)",
                  "Phone (optional)",
                ].map((col) => (
                  <Badge key={col} variant="secondary">
                    {col}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Leagues must already exist. Teams will be created automatically
                if they don't exist in the league.
              </p>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
                <Download className="size-4 mr-2" />
                Download Template
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  onClick={handlePreview}
                  disabled={!selectedFile || previewMutation.isPending}
                >
                  {previewMutation.isPending ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Processing…
                    </>
                  ) : (
                    "Preview Import"
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === "preview" && previewData && (
          <div className="gap-y-4 flex-1 min-h-0 flex flex-col">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SummaryCard
                label="Total Rows"
                value={previewData.totalRows}
                variant="default"
              />
              <SummaryCard
                label="Valid"
                value={previewData.validRows}
                variant="success"
              />
              <SummaryCard
                label="Errors"
                value={previewData.errorRows}
                variant="error"
              />
              <SummaryCard
                label="Duplicates"
                value={previewData.duplicateRows}
                variant="warning"
              />
            </div>

            {previewData.newTeamsToCreate > 0 && (
              <div className="flex items-center gap-2 text-sm bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 rounded-md px-3 py-2">
                <Plus className="size-4 flex-shrink-0" />
                <span>
                  {previewData.newTeamsToCreate} new team
                  {previewData.newTeamsToCreate > 1 ? "s" : ""} will be created
                </span>
              </div>
            )}

            <div className="flex-1 min-h-0 max-h-[350px] rounded-md border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">Row</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>League</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead>Bowler</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewData.rows.map((row) => (
                    <TableRow
                      key={row.rowNumber}
                      className={
                        row.status === "error"
                          ? "bg-red-50/50 dark:bg-red-950/20"
                          : row.status === "duplicate"
                          ? "bg-yellow-50/50 dark:bg-yellow-950/20"
                          : ""
                      }
                    >
                      <TableCell className="text-muted-foreground text-xs">
                        {row.rowNumber}
                      </TableCell>
                      <TableCell>
                        {row.status === "valid" && (
                          <CheckCircle2 className="size-4 text-green-600" />
                        )}
                        {row.status === "error" && (
                          <XCircle className="size-4 text-red-600" />
                        )}
                        {row.status === "duplicate" && (
                          <AlertTriangle className="size-4 text-yellow-600" />
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{row.leagueName}</TableCell>
                      <TableCell className="text-sm">
                        <span>{row.teamName}</span>
                        {row.isNewTeam && (
                          <Badge
                            variant="outline"
                            className="ml-1 text-xs text-blue-600 border-blue-300"
                          >
                            New
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {row.bowlerName}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.email || "—"}
                      </TableCell>
                      <TableCell className="text-xs text-red-600 max-w-[200px] truncate">
                        {row.errors.length > 0 ? row.errors.join("; ") : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep("upload")}>
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={
                    importMutation.isPending || previewData.validRows === 0
                  }
                >
                  {importMutation.isPending ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Importing…
                    </>
                  ) : (
                    `Import ${previewData.validRows} Bowler${previewData.validRows !== 1 ? "s" : ""}`
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === "result" && importResult && (
          <div className="space-y-6 py-4">
            <div className="text-center space-y-2">
              <CheckCircle2 className="size-12 mx-auto text-green-600" />
              <h3 className="text-lg font-semibold">Import Successful</h3>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <SummaryCard
                label="Bowlers Created"
                value={importResult.bowlersCreated}
                variant="success"
              />
              <SummaryCard
                label="Teams Created"
                value={importResult.teamsCreated}
                variant="default"
              />
              <SummaryCard
                label="Rows Skipped"
                value={importResult.rowsSkipped}
                variant={importResult.rowsSkipped > 0 ? "warning" : "default"}
              />
            </div>

            {importResult.createdTeamNames.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">New teams created:</p>
                <div className="flex flex-wrap gap-1">
                  {importResult.createdTeamNames.map((name) => (
                    <Badge key={name} variant="secondary">
                      {name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {importResult.skippedDetails.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                    Skipped rows:
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadErrorReport}
                  >
                    <Download className="size-3 mr-1" />
                    Download Report
                  </Button>
                </div>
                <div className="max-h-[150px] rounded-md border overflow-auto">
                  <div className="p-3 space-y-1">
                    {importResult.skippedDetails.map((detail) => (
                      <p
                        key={detail.rowNumber}
                        className="text-xs text-muted-foreground"
                      >
                        <span className="font-medium">Row {detail.rowNumber}:</span>{" "}
                        {detail.reason}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={handleClose}>Close importer</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SummaryCard({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: "default" | "success" | "error" | "warning";
}) {
  const colors = {
    default: "bg-muted/50",
    success: "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300",
    error: "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300",
    warning:
      "bg-yellow-50 dark:bg-yellow-950/30 text-yellow-700 dark:text-yellow-300",
  };

  return (
    <div className={`rounded-lg p-3 text-center ${colors[variant]}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs">{label}</p>
    </div>
  );
}
