import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { csrfFetch } from "@/lib/queryClient";
import { FileSpreadsheet } from "lucide-react";
import { BulkBowlerImportUploadStep } from "./bulk-bowler-import-upload-step";
import { BulkBowlerImportPreviewStep } from "./bulk-bowler-import-preview-step";
import { BulkBowlerImportResultStep } from "./bulk-bowler-import-result-step";

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
          <BulkBowlerImportUploadStep
            selectedFile={selectedFile}
            isPreviewPending={previewMutation.isPending}
            onFileChange={handleFileChange}
            onDownloadTemplate={handleDownloadTemplate}
            onClose={handleClose}
            onPreview={handlePreview}
          />
        )}

        {step === "preview" && previewData && (
          <BulkBowlerImportPreviewStep
            previewData={previewData}
            isImportPending={importMutation.isPending}
            onBack={() => setStep("upload")}
            onClose={handleClose}
            onImport={handleImport}
          />
        )}

        {step === "result" && importResult && (
          <BulkBowlerImportResultStep
            importResult={importResult}
            onDownloadErrorReport={handleDownloadErrorReport}
            onClose={handleClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
