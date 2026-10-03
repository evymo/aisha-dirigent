import { useTranslation } from "react-i18next";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { format } from "date-fns";
import {
  Calendar,
  ExternalLink,
  FlaskConical,
  Microscope,
  Stethoscope,
  User,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLabResultDetail } from "@/hooks/useLabResultDetail";

interface LabResultDetailProps {
  /** Lab result UUID to fetch and display */
  labResultId: string | null;
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void;
}

/**
 * Human-readable label and unit reference for biomarkers.
 * Uses i18n keys when available, falls back to formatted key name.
 */
const BIOMARKER_UNITS: Record<string, string> = {
  alt: "U/L",
  ast: "U/L",
  cd4_count: "cells/uL",
  cd8_count: "cells/uL",
  cholesterol_total: "mmol/L",
  creatinine: "umol/L",
  crp: "mg/L",
  esr: "mm/h",
  glucose: "mmol/L",
  hba1c: "%",
  hdl: "mmol/L",
  hemoglobin: "g/L",
  il_4: "pg/mL",
  il_6: "pg/mL",
  insulin: "mIU/L",
  ldl: "mmol/L",
  nad_nadh_ratio: "",
  nk_cells: "cells/uL",
  omega3_index: "%",
  platelets: "10^9/L",
  rbc: "10^12/L",
  tnf_alpha: "pg/mL",
  triglycerides: "mmol/L",
  urea: "mmol/L",
  vitamin_b12: "pmol/L",
  vitamin_d: "nmol/L",
  wbc: "10^9/L",
};

/**
 * Returns the status badge variant for lab result status.
 */
function useLabStatusInfo(status: string | null) {
  const { t } = useTranslation();

  switch (status) {
    case "reviewed":
      return {
        label: t("storyloop.labResultDetail.statusReviewed"),
        variant: "default" as const,
      };
    case "completed":
      return {
        label: t("storyloop.labResultDetail.statusCompleted"),
        variant: "secondary" as const,
      };
    case "pending":
    default:
      return {
        label: t("storyloop.labResultDetail.statusPending"),
        variant: "outline" as const,
      };
  }
}

/**
 * Formats a biomarker key into a human-readable label.
 */
function formatBiomarkerLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Modal dialog for viewing lab result details.
 *
 * Fetches the lab result data via audited RPC and renders:
 * - Header metadata (test type, lab, dates, status)
 * - Biomarker table with values and units
 * - Reviewer info
 * - Document link
 */
export function LabResultDetail({
  labResultId,
  open,
  onOpenChange,
}: LabResultDetailProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);

  const { data, isLoading, isError, error } = useLabResultDetail(labResultId, {
    enabled: open && !!labResultId,
  });

  const statusInfo = useLabStatusInfo(data?.status ?? null);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    try {
      return format(new Date(dateStr), "PPp", { locale: dateLocale });
    } catch {
      return dateStr;
    }
  };

  const formatDateShort = (dateStr: string | null) => {
    if (!dateStr) return "—";
    try {
      return format(new Date(dateStr), "PP", { locale: dateLocale });
    } catch {
      return dateStr;
    }
  };

  const biomarkerEntries = data?.biomarkers
    ? Object.entries(data.biomarkers).sort(([a], [b]) => a.localeCompare(b))
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            <span>{t("storyloop.labResultDetail.title")}</span>
          </DialogTitle>
          <DialogDescription>
            {t("storyloop.labResultDetail.description")}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}

        {isError && (
          <Alert variant="destructive">
            <AlertDescription>
              {t("storyloop.labResultDetail.loadError")}
              {error instanceof Error ? `: ${error.message}` : ""}
            </AlertDescription>
          </Alert>
        )}

        {data && (
          <div className="space-y-5">
            {/* Header: test type + status */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Microscope className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {data.test_type ?? t("storyloop.labResultDetail.unknownTestType")}
                </span>
              </div>
              <Badge variant={statusInfo.variant} className="text-xs">
                {statusInfo.label}
              </Badge>
            </div>

            {/* Lab and dates */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              {data.lab_name && (
                <div className="flex items-center gap-2">
                  <Stethoscope className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <span className="text-xs text-muted-foreground block">
                      {t("storyloop.labResultDetail.labName")}
                    </span>
                    <span>{data.lab_name}</span>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <div>
                  <span className="text-xs text-muted-foreground block">
                    {t("storyloop.labResultDetail.testDate")}
                  </span>
                  <span>{formatDateShort(data.test_date)}</span>
                </div>
              </div>
              {data.result_date && (
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <span className="text-xs text-muted-foreground block">
                      {t("storyloop.labResultDetail.resultDate")}
                    </span>
                    <span>{formatDateShort(data.result_date)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Biomarkers table */}
            {biomarkerEntries.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold border-b pb-1">
                  {t("storyloop.labResultDetail.biomarkers")}
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        {t("storyloop.labResultDetail.biomarkerName")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("storyloop.labResultDetail.biomarkerValue")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("storyloop.labResultDetail.biomarkerUnit")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {biomarkerEntries.map(([key, value]) => (
                      <TableRow key={key}>
                        <TableCell className="font-medium">
                          {t(
                            `storyloop.labResultDetail.biomarkerLabels.${key}`,
                            formatBiomarkerLabel(key),
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {typeof value === "number"
                            ? value.toLocaleString(i18n.language)
                            : String(value)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground text-xs">
                          {BIOMARKER_UNITS[key] ?? ""}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Notes */}
            {data.notes && (
              <div className="space-y-1">
                <h3 className="text-sm font-semibold border-b pb-1">
                  {t("storyloop.labResultDetail.notes")}
                </h3>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {data.notes}
                </p>
              </div>
            )}

            {/* Reviewer info */}
            {data.reviewed_by && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground pt-2 border-t">
                <User className="h-4 w-4" />
                <span>
                  {t("storyloop.labResultDetail.reviewedBy", {
                    name: data.reviewer_display_name ?? data.reviewed_by,
                  })}
                </span>
                {data.reviewed_at && (
                  <span className="ml-1">
                    ({formatDate(data.reviewed_at)})
                  </span>
                )}
              </div>
            )}

            {/* File link */}
            {data.file_url && (
              <div className="pt-2 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="gap-2"
                >
                  <a
                    href={data.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-4 w-4" />
                    {t("storyloop.labResultDetail.viewDocument")}
                  </a>
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
