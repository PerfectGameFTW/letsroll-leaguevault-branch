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
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Plus,
} from "lucide-react";
import { BulkBowlerImportSummaryCard } from "./bulk-bowler-import-summary-card";

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

interface BulkBowlerImportPreviewStepProps {
  previewData: PreviewResult;
  isImportPending: boolean;
  onBack: () => void;
  onClose: () => void;
  onImport: () => void;
}

export function BulkBowlerImportPreviewStep({
  previewData,
  isImportPending,
  onBack,
  onClose,
  onImport,
}: BulkBowlerImportPreviewStepProps) {
  return (
    <div className="gap-y-4 flex-1 min-h-0 flex flex-col">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <BulkBowlerImportSummaryCard
          label="Total Rows"
          value={previewData.totalRows}
          variant="default"
        />
        <BulkBowlerImportSummaryCard
          label="Valid"
          value={previewData.validRows}
          variant="success"
        />
        <BulkBowlerImportSummaryCard
          label="Errors"
          value={previewData.errorRows}
          variant="error"
        />
        <BulkBowlerImportSummaryCard
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
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={onImport}
            disabled={
              isImportPending || previewData.validRows === 0
            }
          >
            {isImportPending ? (
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
  );
}
