interface SummaryCardProps {
  label: string;
  value: number;
  variant: "default" | "success" | "error" | "warning";
}

export function BulkBowlerImportSummaryCard({
  label,
  value,
  variant,
}: SummaryCardProps) {
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
