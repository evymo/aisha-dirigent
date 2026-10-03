/**
 * Blood Matrix Analysis Block Form
 *
 * Form for creating a structured 3x3 blood matrix analysis entry.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Microscope, RotateCcw, WandSparkles, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  BLOOD_MATRIX_AI_PRESET,
  BLOOD_MATRIX_CELL_KEYS,
  buildBloodMatrixAssessment,
  createBloodMatrixAiPrompt,
  createEmptyBloodMatrixMap,
  type BloodMatrixAnalysisSource,
  type BloodMatrixCellKey,
  type BloodMatrixGrade,
} from "@/lib/blood-matrix";
import type { BloodMatrixAnalysisMetadata } from "@/schemas/storyLoopSchemas";

interface BloodMatrixAnalysisBlockFormProps {
  onSubmit: (metadata: Omit<BloodMatrixAnalysisMetadata, "type">, content?: string) => void;
  onCancel: () => void;
  isPending?: boolean;
}

const gradeOptions: readonly BloodMatrixGrade[] = ["0", "I", "II", "III"] as const;

const gradeStyles: Record<BloodMatrixGrade, string> = {
  "0": "border-muted text-muted-foreground",
  I: "border-info/30 text-info",
  II: "border-warning/40 text-warning",
  III: "border-destructive/40 text-destructive",
};

/**
 * Form component for creating a blood matrix analysis block.
 */
export function BloodMatrixAnalysisBlockForm({
  onSubmit,
  onCancel,
  isPending,
}: BloodMatrixAnalysisBlockFormProps) {
  const { t } = useTranslation();
  const today = new Date().toISOString().split("T")[0];

  const [sampleDate, setSampleDate] = useState(today);
  const [analysisSource, setAnalysisSource] = useState<BloodMatrixAnalysisSource>("manual");
  const [matrix, setMatrix] = useState(createEmptyBloodMatrixMap());
  const [summaryNote, setSummaryNote] = useState("");
  const [nextCheckDate, setNextCheckDate] = useState("");
  const [aiSummary, setAiSummary] = useState("");

  const assessment = useMemo(() => buildBloodMatrixAssessment(matrix), [matrix]);

  const aiPrompt = useMemo(
    () =>
      createBloodMatrixAiPrompt({
        matrix,
        summary_note: summaryNote,
        analysis_source: analysisSource,
      }),
    [analysisSource, matrix, summaryNote]
  );

  const reportText = useMemo(() => {
    const matrixLines = BLOOD_MATRIX_CELL_KEYS.map((key) => {
      const title = t(`storyloop.bloodMatrix.squares.${key}.title`);
      const note = matrix[key].note?.trim();
      return note
        ? `${key}. ${title}: ${matrix[key].grade} (${note})`
        : `${key}. ${title}: ${matrix[key].grade}`;
    }).join("\n");

    const productLines = assessment.product_recommendations.length
      ? assessment.product_recommendations
          .map(
            (item) =>
              `- ${t(`storyloop.bloodMatrix.products.${item.code}`)} (${t(
                `storyloop.bloodMatrix.priority.${item.priority}`
              )})`
          )
          .join("\n")
      : `- ${t("storyloop.bloodMatrix.noProductRecommendation")}`;

    const protocolLines = assessment.protocol_step_keys
      .map((step) => `- ${t(`storyloop.bloodMatrix.protocol.${step}`)}`)
      .join("\n");

    const parts = [
      `=== ${t("storyloop.bloodMatrix.report.title")} ===`,
      `${t("storyloop.bloodMatrix.sampleDate")}: ${sampleDate}`,
      `${t("storyloop.bloodMatrix.sourceLabel")}: ${t(`storyloop.bloodMatrix.source.${analysisSource}`)}`,
      "",
      matrixLines,
      "",
      `I: ${assessment.counts.I} | II: ${assessment.counts.II} | III: ${assessment.counts.III}`,
      `${t(`storyloop.bloodMatrix.severity.${assessment.severity.level}`)}`,
      t("storyloop.bloodMatrix.recommendedDuration", {
        min: assessment.severity.recommended_days_min,
        max: assessment.severity.recommended_days_max,
      }),
      "",
      t("storyloop.bloodMatrix.protocolTitle"),
      protocolLines,
      "",
      t("storyloop.bloodMatrix.productsTitle"),
      productLines,
      "",
      `${t("storyloop.bloodMatrix.summaryNote")}: ${summaryNote.trim() || "-"}`,
      `${t("storyloop.bloodMatrix.nextCheck")}: ${nextCheckDate || "-"}`,
      aiSummary.trim() ? `${t("storyloop.bloodMatrix.aiSummary")}: ${aiSummary.trim()}` : "",
    ];

    return parts.filter(Boolean).join("\n");
  }, [aiSummary, analysisSource, assessment, matrix, nextCheckDate, sampleDate, summaryNote, t]);

  const handleCellGradeChange = (key: BloodMatrixCellKey, grade: BloodMatrixGrade): void => {
    setMatrix((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        grade,
      },
    }));
  };

  const handleCellNoteChange = (key: BloodMatrixCellKey, note: string): void => {
    setMatrix((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        note,
      },
    }));
  };

  const handleLoadPreset = (): void => {
    setMatrix(BLOOD_MATRIX_AI_PRESET);
    setAnalysisSource("ai_photo");
    toast.success(t("storyloop.bloodMatrix.presetLoaded"));
  };

  const handleReset = (): void => {
    setMatrix(createEmptyBloodMatrixMap());
    setAnalysisSource("manual");
    setSummaryNote("");
    setAiSummary("");
    setNextCheckDate("");
  };

  const copyToClipboard = async (value: string, successKey: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t(successKey));
    } catch {
      toast.error(t("errors.genericError"));
    }
  };

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();

    const metadata: Omit<BloodMatrixAnalysisMetadata, "type"> = {
      sample_date: sampleDate ? new Date(sampleDate).toISOString() : new Date().toISOString(),
      analysis_source: analysisSource,
      matrix,
      counts: assessment.counts,
      weighted_score: assessment.weighted_score,
      severity: assessment.severity,
      protocol_step_keys: assessment.protocol_step_keys,
      product_recommendations: assessment.product_recommendations,
      severe_parasite_signal: assessment.severe_parasite_signal,
      report_text: reportText,
      ai_prompt: aiPrompt,
      ...(summaryNote.trim() ? { summary_note: summaryNote.trim() } : {}),
      ...(nextCheckDate ? { next_check_date: new Date(nextCheckDate).toISOString() } : {}),
      ...(aiSummary.trim() ? { ai_summary: aiSummary.trim() } : {}),
    };

    onSubmit(metadata, t("storyloop.bloodMatrix.content"));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>{t("storyloop.bloodMatrix.sampleDate")}</Label>
          <Input
            type="date"
            value={sampleDate}
            onChange={(event) => setSampleDate(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("storyloop.bloodMatrix.sourceLabel")}</Label>
          <Select value={analysisSource} onValueChange={(value) => setAnalysisSource(value as BloodMatrixAnalysisSource)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">{t("storyloop.bloodMatrix.source.manual")}</SelectItem>
              <SelectItem value="ai_photo">{t("storyloop.bloodMatrix.source.ai_photo")}</SelectItem>
              <SelectItem value="hybrid">{t("storyloop.bloodMatrix.source.hybrid")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={handleLoadPreset}>
          <WandSparkles className="mr-1.5 h-3.5 w-3.5" />
          {t("storyloop.bloodMatrix.loadPreset")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={handleReset}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          {t("storyloop.bloodMatrix.reset")}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {BLOOD_MATRIX_CELL_KEYS.map((key) => (
          <Card key={key} className="border">
            <CardContent className="space-y-2 p-3">
              <div className="flex items-start gap-2">
                <Microscope className="mt-0.5 h-4 w-4 text-primary" />
                <p className="text-sm font-medium">
                  {key}. {t(`storyloop.bloodMatrix.squares.${key}.title`)}
                </p>
              </div>

              <div className="grid grid-cols-4 gap-1">
                {gradeOptions.map((grade) => {
                  const active = matrix[key].grade === grade;
                  return (
                    <button
                      key={grade}
                      type="button"
                      onClick={() => handleCellGradeChange(key, grade)}
                      className={cn(
                        "rounded border px-2 py-1 text-xs transition-colors",
                        gradeStyles[grade],
                        active ? "bg-primary/10 border-primary text-primary font-semibold" : "hover:bg-muted/40"
                      )}
                    >
                      {grade}
                    </button>
                  );
                })}
              </div>

              <Textarea
                value={matrix[key].note ?? ""}
                onChange={(event) => handleCellNoteChange(key, event.target.value)}
                placeholder={t("storyloop.bloodMatrix.notePlaceholder")}
                className="min-h-[62px] text-xs"
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-2">
        <Label>{t("storyloop.bloodMatrix.summaryNote")}</Label>
        <Textarea
          value={summaryNote}
          onChange={(event) => setSummaryNote(event.target.value)}
          placeholder={t("storyloop.bloodMatrix.summaryPlaceholder")}
          className="min-h-[72px]"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>{t("storyloop.bloodMatrix.nextCheck")}</Label>
          <Input
            type="date"
            value={nextCheckDate}
            onChange={(event) => setNextCheckDate(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("storyloop.bloodMatrix.aiSummary")}</Label>
          <Textarea
            value={aiSummary}
            onChange={(event) => setAiSummary(event.target.value)}
            placeholder={t("storyloop.bloodMatrix.aiSummaryPlaceholder")}
            className="min-h-[72px]"
          />
        </div>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="space-y-2 p-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">I: {assessment.counts.I}</Badge>
            <Badge variant="outline">II: {assessment.counts.II}</Badge>
            <Badge variant="outline">III: {assessment.counts.III}</Badge>
            <Badge variant="outline">
              {t("storyloop.bloodMatrix.weightedScore")}: {assessment.weighted_score}
            </Badge>
          </div>
          <p className="text-sm font-medium">
            {t(`storyloop.bloodMatrix.severity.${assessment.severity.level}`)}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("storyloop.bloodMatrix.recommendedDuration", {
              min: assessment.severity.recommended_days_min,
              max: assessment.severity.recommended_days_max,
            })}
          </p>
          <div className="space-y-1 pt-1">
            {assessment.product_recommendations.slice(0, 5).map((item) => (
              <p key={item.code} className="text-xs text-muted-foreground">
                • {t(`storyloop.bloodMatrix.products.${item.code}`)}
              </p>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label>{t("storyloop.bloodMatrix.report.preview")}</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void copyToClipboard(reportText, "storyloop.bloodMatrix.reportCopied");
            }}
          >
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            {t("storyloop.bloodMatrix.copyReport")}
          </Button>
        </div>
        <Textarea value={reportText} readOnly className="min-h-[180px] font-mono text-xs" />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label>{t("storyloop.bloodMatrix.aiPromptTitle")}</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void copyToClipboard(aiPrompt, "storyloop.bloodMatrix.aiPromptCopied");
            }}
          >
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            {t("storyloop.bloodMatrix.copyAiPrompt")}
          </Button>
        </div>
        <Textarea value={aiPrompt} readOnly className="min-h-[100px] text-xs" />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={isPending}>
          {t("common.create")}
        </Button>
      </div>
    </form>
  );
}
