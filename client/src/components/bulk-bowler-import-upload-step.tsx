import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, Download, Loader2 } from "lucide-react";

interface BulkBowlerImportUploadStepProps {
  selectedFile: File | null;
  isPreviewPending: boolean;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDownloadTemplate: () => void;
  onClose: () => void;
  onPreview: () => void;
}

export function BulkBowlerImportUploadStep({
  selectedFile,
  isPreviewPending,
  onFileChange,
  onDownloadTemplate,
  onClose,
  onPreview,
}: BulkBowlerImportUploadStepProps) {
  return (
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
            onChange={onFileChange}
            className="hidden"
            id="bulk-import-file"
            aria-label="Upload CSV or XLSX file"
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
        <Button variant="outline" size="sm" onClick={onDownloadTemplate}>
          <Download className="size-4 mr-2" />
          Download Template
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={onPreview}
            disabled={!selectedFile || isPreviewPending}
          >
            {isPreviewPending ? (
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
  );
}
