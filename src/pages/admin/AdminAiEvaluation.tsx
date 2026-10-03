/**
 * Admin page for AI Evaluation — LLM-as-Judge quality dashboard.
 *
 * Displays:
 * - Summary cards (total runs, avg overall score, golden examples count)
 * - Evaluation runs list with status, scores, and delta
 * - Expandable per-run results with 4-dimension breakdown
 * - Golden examples section
 *
 * @module pages/admin/AdminAiEvaluation
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FlaskConical,
  Play,
  Plus,
  ChevronDown,
  ChevronRight,
  Star,
  TrendingUp,
  TrendingDown,
  Clock,
  MessageSquare,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { usePermissions } from "@/hooks/usePermissions";
import {
  useEvalRuns,
  useEvalResults,
  useStartEvalRun,
} from "@/hooks/useAiEvaluation";
import type { EvalRun } from "@/hooks/useAiEvaluation";

// ============================================================================
// Helpers
// ============================================================================

/** Format a 0-1 score to percentage display. */
function formatScore(score: number | null | undefined): string {
  if (score == null) return "-";
  return `${(score * 100).toFixed(1)}%`;
}

/** Format ISO timestamp to short local datetime. */
function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Score color coding. */
function scoreColor(score: number | null | undefined): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 0.8) return "text-green-600 dark:text-green-400";
  if (score >= 0.6) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

/** Status badge variant. */
function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
      return "default";
    case "running":
      return "secondary";
    case "failed":
      return "destructive";
    default:
      return "outline";
  }
}

// ============================================================================
// Sub-components
// ============================================================================

function ScoreBar({ label, value }: { label: string; value: number | null | undefined }) {
  const pct = value != null ? value * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={scoreColor(value)}>{formatScore(value)}</span>
      </div>
      <Progress value={pct} className="h-2" />
    </div>
  );
}

function EvalRunRow({ run }: { run: EvalRun }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <TableRow className="cursor-pointer hover:bg-muted/50">
        <TableCell>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
        </TableCell>
        <TableCell className="font-mono text-xs">{run.id.slice(0, 8)}</TableCell>
        <TableCell>
          <Badge variant={statusVariant(run.status)}>
            {t(`admin.aiEvaluation.status.${run.status}`, run.status)}
          </Badge>
        </TableCell>
        <TableCell>
          <Badge variant="outline">
            {t(`admin.aiEvaluation.trigger.${run.trigger_type}`, run.trigger_type)}
          </Badge>
        </TableCell>
        <TableCell className="text-center">
          {run.completed_examples}/{run.total_examples}
        </TableCell>
        <TableCell className={scoreColor(run.avg_overall)}>
          {formatScore(run.avg_overall)}
        </TableCell>
        <TableCell>
          {run.score_delta != null ? (
            <span className={run.score_delta >= 0 ? "text-green-600 flex items-center gap-1" : "text-red-600 flex items-center gap-1"}>
              {run.score_delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {(run.score_delta * 100).toFixed(1)}%
            </span>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {formatDate(run.created_at)}
        </TableCell>
      </TableRow>
      <CollapsibleContent asChild>
        <TableRow>
          <TableCell colSpan={8} className="bg-muted/30 p-4">
            <EvalRunDetails runId={run.id} run={run} />
          </TableCell>
        </TableRow>
      </CollapsibleContent>
    </Collapsible>
  );
}

function EvalRunDetails({ runId, run }: { runId: string; run: EvalRun }) {
  const { t } = useTranslation();
  const { data: results, isLoading } = useEvalResults(runId);

  return (
    <div className="space-y-4">
      {/* Score breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <ScoreBar label={t("admin.aiEvaluation.scores.relevance")} value={run.avg_relevance} />
        <ScoreBar label={t("admin.aiEvaluation.scores.groundedness")} value={run.avg_groundedness} />
        <ScoreBar label={t("admin.aiEvaluation.scores.safety")} value={run.avg_safety} />
        <ScoreBar label={t("admin.aiEvaluation.scores.coherence")} value={run.avg_coherence} />
        <ScoreBar label={t("admin.aiEvaluation.scores.overall")} value={run.avg_overall} />
      </div>

      {/* Per-message results */}
      <div>
        <h4 className="text-sm font-medium mb-2">{t("admin.aiEvaluation.results")}</h4>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : !results?.length ? (
          <p className="text-sm text-muted-foreground">{t("admin.aiEvaluation.noResults")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.aiEvaluation.messageId")}</TableHead>
                <TableHead>{t("admin.aiEvaluation.scores.relevance")}</TableHead>
                <TableHead>{t("admin.aiEvaluation.scores.groundedness")}</TableHead>
                <TableHead>{t("admin.aiEvaluation.scores.safety")}</TableHead>
                <TableHead>{t("admin.aiEvaluation.scores.coherence")}</TableHead>
                <TableHead>{t("admin.aiEvaluation.scores.overall")}</TableHead>
                <TableHead>{t("admin.aiEvaluation.evaluatorModel")}</TableHead>
                <TableHead>{t("admin.aiEvaluation.latency")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.message_id.slice(0, 8)}</TableCell>
                  <TableCell className={scoreColor(r.relevance_score)}>{formatScore(r.relevance_score)}</TableCell>
                  <TableCell className={scoreColor(r.groundedness_score)}>{formatScore(r.groundedness_score)}</TableCell>
                  <TableCell className={scoreColor(r.safety_score)}>{formatScore(r.safety_score)}</TableCell>
                  <TableCell className={scoreColor(r.coherence_score)}>{formatScore(r.coherence_score)}</TableCell>
                  <TableCell className={scoreColor(r.overall_score)}>{formatScore(r.overall_score)}</TableCell>
                  <TableCell className="text-xs">{r.evaluator_model}</TableCell>
                  <TableCell className="text-xs">{r.latency_ms != null ? `${r.latency_ms}ms` : "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function AdminAiEvaluation() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  const canManage = hasPermission("manage_agents");

  const { data: runs, isLoading: runsLoading, error: runsError } = useEvalRuns(undefined, 50);
  const { mutate: startRun, isPending: starting } = useStartEvalRun();

  const [activeTab, setActiveTab] = useState<"runs" | "golden">("runs");

  if (!canView) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>{t("common.permissionDenied")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const handleCreateAndStart = () => {
    // TODO: Re-implement after channel-centric eval pipeline is ready
  };

  // Summary stats
  const totalRuns = runs?.length ?? 0;
  const completedRuns = runs?.filter((r) => r.status === "completed") ?? [];
  const avgOverall =
    completedRuns.length > 0
      ? completedRuns.reduce((sum, r) => sum + (r.avg_overall ?? 0), 0) / completedRuns.length
      : null;
  const lastRun = runs?.[0] ?? null;
  const goldenCount = 0; // TODO: golden examples removed in channel-centric migration

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FlaskConical className="h-6 w-6" />
            {t("admin.aiEvaluation.title")}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t("admin.aiEvaluation.description")}
          </p>
        </div>
        {canManage && (
          <Button onClick={handleCreateAndStart} disabled={starting}>
            <Plus className="h-4 w-4 mr-2" />
            {starting ? (
              <span className="animate-pulse">{t("admin.aiEvaluation.startRun")}</span>
            ) : (
              t("admin.aiEvaluation.createRun")
            )}
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.aiEvaluation.summaryCards.totalRuns")}</CardDescription>
          </CardHeader>
          <CardContent>
            {runsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{totalRuns}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.aiEvaluation.summaryCards.avgOverall")}</CardDescription>
          </CardHeader>
          <CardContent>
            {runsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className={`text-2xl font-bold ${scoreColor(avgOverall)}`}>
                {formatScore(avgOverall)}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.aiEvaluation.summaryCards.goldenCount")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
                <Star className="h-5 w-5 text-yellow-500" />
                {goldenCount}
              </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.aiEvaluation.summaryCards.lastRun")}</CardDescription>
          </CardHeader>
          <CardContent>
            {runsLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : lastRun ? (
              <div className="flex items-center gap-2">
                <Badge variant={statusVariant(lastRun.status)}>
                  {t(`admin.aiEvaluation.status.${lastRun.status}`, lastRun.status)}
                </Badge>
                <span className="text-xs text-muted-foreground">{formatDate(lastRun.created_at)}</span>
              </div>
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tab Buttons */}
      <div className="flex gap-2">
        <Button
          variant={activeTab === "runs" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("runs")}
        >
          <Play className="h-4 w-4 mr-1" />
          {t("admin.aiEvaluation.evalRuns")}
        </Button>
        <Button
          variant={activeTab === "golden" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("golden")}
        >
          <Star className="h-4 w-4 mr-1" />
          {t("admin.aiEvaluation.goldenExamples")}
          {goldenCount > 0 && (
            <Badge variant="secondary" className="ml-2">{goldenCount}</Badge>
          )}
        </Button>
      </div>

      {/* Error */}
      {runsError && (
        <Alert variant="destructive">
          <AlertDescription>{t("admin.aiEvaluation.errorLoading")}</AlertDescription>
        </Alert>
      )}

      {/* Evaluation Runs Tab */}
      {activeTab === "runs" && (
        <Card>
          <CardHeader>
            <CardTitle>{t("admin.aiEvaluation.evalRuns")}</CardTitle>
            <CardDescription>{t("admin.aiEvaluation.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            {runsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : !runs?.length ? (
              <div className="text-center py-8">
                <FlaskConical className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">{t("admin.aiEvaluation.noRuns")}</p>
                {canManage && (
                  <Button variant="outline" className="mt-4" onClick={handleCreateAndStart}>
                    <Plus className="h-4 w-4 mr-2" />
                    {t("admin.aiEvaluation.createRun")}
                  </Button>
                )}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>{t("admin.aiEvaluation.id")}</TableHead>
                    <TableHead>{t("admin.aiEvaluation.runStatus")}</TableHead>
                    <TableHead>{t("admin.aiEvaluation.triggerType")}</TableHead>
                    <TableHead className="text-center">{t("admin.aiEvaluation.completedExamples")}</TableHead>
                    <TableHead>{t("admin.aiEvaluation.scores.overall")}</TableHead>
                    <TableHead>{t("admin.aiEvaluation.scoreDelta")}</TableHead>
                    <TableHead>{t("common.createdAt")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <EvalRunRow key={run.id} run={run} />
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Golden Examples Tab */}
      {activeTab === "golden" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Star className="h-5 w-5 text-yellow-500" />
              {t("admin.aiEvaluation.goldenExamples")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8">
                <Star className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">{t("admin.aiEvaluation.noGoldenExamples")}</p>
              </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
