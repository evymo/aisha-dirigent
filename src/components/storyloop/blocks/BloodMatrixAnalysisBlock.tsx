/**
 * Blood Matrix Analysis Block
 *
 * Displays a structured 3x3 blood drop matrix analysis in StoryLoop.
 */

import { useTranslation } from "react-i18next";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { Microscope, Calendar, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  BLOOD_MATRIX_CELL_KEYS,
  type BloodMatrixCellKey,
  type BloodMatrixGrade,
} from "@/lib/blood-matrix";
import type { BloodMatrixAnalysisMetadata } from "@/schemas/storyLoopSchemas";
import { format } from "date-fns";
interface BloodMatrixAnalysisBlockProps {
  metadata: BloodMatrixAnalysisMetadata;
  entryId: string;
  storyId: string;
  isPartnerView?: boolean;
}

const gradeStyles: Record<BloodMatrixGrade, string> = {
  "0": "bg-muted text-muted-foreground",
  I: "bg-info/10 text-info border border-info/30",
  II: "bg-warning/10 text-warning border border-warning/30",
  III: "bg-destructive/10 text-destructive border border-destructive/30",
};

const priorityStyles = {
  core: "bg-primary/10 text-primary border-primary/20",
  support: "bg-secondary/10 text-secondary border-secondary/20",
  optional: "bg-muted text-muted-foreground border-muted",
} as const;

/**
 * Renders blood matrix analysis details and generic product recommendations.
 */
export function BloodMatrixAnalysisBlock({
  metadata,
  entryId: _entryId,
  storyId: _storyId,
  isPartnerView: _isPartnerView = true,
}: BloodMatrixAnalysisBlockProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);

  const formatDate = (value?: string): string | null => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return format(date, "PP", { locale: dateLocale });
  };

  const sampleDate = formatDate(metadata.sample_date) ?? metadata.sample_date;
  const nextCheckDate = formatDate(metadata.next_check_date);

  return (
    <Card className="border border-primary/20 bg-primary/5">
      <CardContent className="space-y-4 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-background p-1.5">
              <Microscope className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">{t("storyloop.bloodMatrix.title")}</p>
              <p className="text-xs text-muted-foreground">
                {t("storyloop.bloodMatrix.sampleDate")}: {sampleDate}
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-xs">
            {t(`storyloop.bloodMatrix.source.${metadata.analysis_source}`)}
          </Badge>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="text-xs">
            I: {metadata.counts.I}
          </Badge>
          <Badge variant="outline" className="text-xs">
            II: {metadata.counts.II}
          </Badge>
          <Badge variant="outline" className="text-xs">
            III: {metadata.counts.III}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {t("storyloop.bloodMatrix.weightedScore")}: {metadata.weighted_score}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {BLOOD_MATRIX_CELL_KEYS.map((key) => {
            const observation = metadata.matrix[key] as { grade?: BloodMatrixGrade; note?: string } | undefined;
            const grade: BloodMatrixGrade = observation?.grade ?? '0';
            const note = observation?.note?.trim();
            const noteKey = note ? `storyloop.bloodMatrix.notes.${note}` : "";
            const translatedNote = noteKey ? t(noteKey) : "";
            const noteLabel =
              note && translatedNote !== noteKey ? translatedNote : note;
            return (
              <div key={key} className="rounded-md border bg-background p-2">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <p className="text-xs font-medium">
                    {key}. {t(`storyloop.bloodMatrix.squares.${key}.title`)}
                  </p>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-xs font-semibold",
                      gradeStyles[grade]
                    )}
                  >
                    {grade}
                  </span>
                </div>
                {note ? (
                  <p className="text-xs text-muted-foreground">
                    {noteLabel}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("storyloop.bloodMatrix.noNote")}</p>
                )}
              </div>
            );
          })}
        </div>

        <div className="rounded-md border bg-background p-2.5">
          <p className="text-sm font-medium">
            {t(`storyloop.bloodMatrix.severity.${metadata.severity.level}`)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("storyloop.bloodMatrix.recommendedDuration", {
              min: metadata.severity.recommended_days_min,
              max: metadata.severity.recommended_days_max,
            })}
          </p>
          {metadata.severe_parasite_signal && (
            <div className="mt-2 flex items-start gap-1.5 rounded border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{t("storyloop.bloodMatrix.parasiteSignal")}</span>
            </div>
          )}
        </div>

        <div className="space-y-2 rounded-md border bg-background p-2.5">
          <p className="text-sm font-medium">{t("storyloop.bloodMatrix.protocolTitle")}</p>
          <div className="space-y-1">
            {metadata.protocol_step_keys.map((stepKey) => (
              <p key={stepKey} className="text-xs text-muted-foreground">
                • {t(`storyloop.bloodMatrix.protocol.${stepKey}`)}
              </p>
            ))}
          </div>
        </div>

        <div className="space-y-2 rounded-md border bg-background p-2.5">
          <p className="text-sm font-medium">{t("storyloop.bloodMatrix.productsTitle")}</p>
          {metadata.product_recommendations.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("storyloop.bloodMatrix.noProductRecommendation")}</p>
          ) : (
            <div className="space-y-2">
              {metadata.product_recommendations.map((item) => (
                <div key={item.code} className="rounded border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {t(`storyloop.bloodMatrix.products.${item.code}`)}
                    </p>
                    <Badge
                      variant="outline"
                      className={cn("text-[10px]", priorityStyles[(item.priority in priorityStyles ? item.priority : 'optional') as keyof typeof priorityStyles])}
                    >
                      {t(`storyloop.bloodMatrix.priority.${item.priority}`)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.reason_cell_keys
                      .map((cellKey) =>
                        t("storyloop.bloodMatrix.reasonFromSquare", {
                          square: `${cellKey}. ${t(`storyloop.bloodMatrix.squares.${cellKey as BloodMatrixCellKey}.title`)}`,
                        })
                      )
                      .join(" • ")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {metadata.summary_note && (
          <div className="rounded-md border bg-background p-2.5">
            <p className="text-sm font-medium">{t("storyloop.bloodMatrix.summaryNote")}</p>
            <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{metadata.summary_note}</p>
          </div>
        )}

        {(nextCheckDate || metadata.ai_summary) && (
          <div className="space-y-2 rounded-md border bg-background p-2.5">
            {nextCheckDate && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                {t("storyloop.bloodMatrix.nextCheck")}: {nextCheckDate}
              </p>
            )}
            {metadata.ai_summary && (
              <div>
                <p className="text-sm font-medium">{t("storyloop.bloodMatrix.aiSummary")}</p>
                <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                  {metadata.ai_summary}
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
