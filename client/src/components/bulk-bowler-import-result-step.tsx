import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, CheckCircle2 } from "lucide-react";
import { BulkBowlerImportSummaryCard } from "./bulk-bowler-import-summary-card";

interface ImportResult {
  bowlersCreated: number;
  teamsCreated: number;
  rowsSkipped: number;
  totalRows: number;
  createdTeamNames: string[];
  skippedDetails: { rowNumber: number; reason: string }[];
}

interface BulkBowlerImportResultStepProps {
  importResult: ImportResult;
  onDownloadErrorReport: () => void;
  onClose: () => void;
}

export function BulkBowlerImportResultStep({
  importResult,
  onDownloadErrorReport,
  onClose,
}: BulkBowlerImportResultStepProps) {
  return (
    <div className="space-y-6 py-4">
      <div className="text-center space-y-2">
        <CheckCircle2 className="size-12 mx-auto text-green-600" />
        <h3 className="text-lg font-semibold">Import Successful</h3>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <BulkBowlerImportSummaryCard
          label="Bowlers Created"
          value={importResult.bowlersCreated}
          variant="success"
        />
        <BulkBowlerImportSummaryCard
          label="Teams Created"
          value={importResult.teamsCreated}
          variant="default"
        />
        <BulkBowlerImportSummaryCard
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
              onClick={onDownloadErrorReport}
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
        <Button onClick={onClose}>Close importer</Button>
      </div>
    </div>
  );
}
