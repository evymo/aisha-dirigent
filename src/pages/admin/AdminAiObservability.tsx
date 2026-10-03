/**
 * Admin page for AI Observability — Agent Metrics Dashboard.
 *
 * Displays:
 * - Run summary cards (total runs, by status, avg duration)
 * - Per-agent metrics table (events, latency, cost, error rate)
 * - Refresh materialized view action
 *
 * @module pages/admin/AdminAiObservability
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  RefreshCw,
  Clock,
  Zap,
  DollarSign,
  AlertTriangle,
  Activity,
  Gauge,
  Target,
  ShieldCheck,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePermissions } from "@/hooks/usePermissions";
import {
  useAiAgentMetrics,
  useAiRunSummary,
  useRefreshAiAgentMetrics,
} from "@/hooks/useAiAgentMetrics";
import { DecisionLensCard } from "@/components/admin/mission-control/DecisionLensCard";
import { useRagBaseline, averageMetric } from "@/hooks/useRagBaseline";

const HOURS_OPTIONS = [
  { value: "24", labelKey: "admin.observability.period.hours24" },
  { value: "48", labelKey: "admin.observability.period.hours48" },
  { value: "168", labelKey: "admin.observability.period.days7" },
  { value: "720", labelKey: "admin.observability.period.days30" },
] as const;

export default function AdminAiObservability() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");

  const [hoursBack, setHoursBack] = useState(168);

  const {
    data: metrics,
    isLoading: metricsLoading,
    refetch: refetchMetrics,
  } = useAiAgentMetrics({ hoursBack });
  const { data: runSummary, isLoading: summaryLoading } = useAiRunSummary({
    hoursBack,
  });
  const { mutate: refreshView, isPending: refreshing } =
    useRefreshAiAgentMetrics();
  const { data: ragBaseline, isLoading: ragLoading } = useRagBaseline(
    null,
    null,
    hoursBack,
  );

  if (!canView) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>{t("common.permissionDenied")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const handleRefresh = () => {
    refreshView(undefined, {
      onSuccess: () => {
        refetchMetrics();
      },
    });
  };

  const formatMs = (ms: number | null | undefined) => {
    if (ms == null) return "-";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatCost = (usd: number | null | undefined) => {
    if (usd == null) return "-";
    return `$${Number(usd).toFixed(4)}`;
  };

  const formatTokens = (tokens: number | null | undefined) => {
    if (tokens == null) return "-";
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
    return String(tokens);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {t("admin.aiObservability.title")}
            </h1>
            <p className="text-muted-foreground">
              {t("admin.aiObservability.description")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={String(hoursBack)}
            onValueChange={(v) => setHoursBack(Number(v))}
          >
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOURS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw
              className={`h-4 w-4 mr-1 ${refreshing ? "animate-spin" : ""}`}
            />
            {t("admin.aiObservability.refreshMetrics")}
          </Button>
        </div>
      </div>

      {/* Run Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {summaryLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1">
                  <Activity className="h-4 w-4" />
                  {t("admin.aiObservability.totalRuns")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">
                  {runSummary?.total_runs ?? 0}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  {t("admin.aiObservability.avgDuration")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">
                  {formatMs(runSummary?.avg_duration_ms)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1">
                  <Zap className="h-4 w-4" />
                  {t("admin.aiObservability.successRate")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">
                  {runSummary && runSummary.total_runs > 0
                    ? `${(
                        ((runSummary.by_status["success"] ?? 0) /
                          runSummary.total_runs) *
                        100
                      ).toFixed(1)}%`
                    : "-"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4" />
                  {t("admin.aiObservability.failedRuns")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-destructive">
                  {(runSummary?.by_status["failed"] ?? 0) +
                    (runSummary?.by_status["cancelled"] ?? 0)}
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* RAG Retrieval Quality (Step 0 of optimization plan 2026) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-5 w-5 text-primary" />
            {t("rag.baseline.title")}
          </CardTitle>
          <CardDescription>{t("rag.baseline.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {ragLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="border-dashed">
                  <CardHeader className="pb-2">
                    <Skeleton className="h-4 w-24" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-8 w-16" />
                  </CardContent>
                </Card>
              ))
            ) : !ragBaseline || ragBaseline.length === 0 ? (
              <Card className="md:col-span-4 border-dashed">
                <CardContent className="py-6 text-center text-muted-foreground">
                  {t("rag.baseline.noData")}
                </CardContent>
              </Card>
            ) : (
              <>
                <Card className="border-dashed">
                  <CardHeader className="pb-2">
                    <CardDescription
                      className="flex items-center gap-1"
                      title={t("rag.baseline.faithfulnessHint")}
                    >
                      <ShieldCheck className="h-4 w-4" />
                      {t("rag.baseline.faithfulness")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold">
                      {(() => {
                        const v = averageMetric(ragBaseline, "faithfulness_avg");
                        return v === null ? "-" : v.toFixed(2);
                      })()}
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-dashed">
                  <CardHeader className="pb-2">
                    <CardDescription
                      className="flex items-center gap-1"
                      title={t("rag.baseline.contextRecallHint")}
                    >
                      <Target className="h-4 w-4" />
                      {t("rag.baseline.contextRecall")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold">
                      {(() => {
                        const v = averageMetric(ragBaseline, "context_recall_avg");
                        return v === null ? "-" : v.toFixed(2);
                      })()}
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-dashed">
                  <CardHeader className="pb-2">
                    <CardDescription className="flex items-center gap-1">
                      <BarChart3 className="h-4 w-4" />
                      {t("rag.baseline.compositeScore")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold">
                      {(() => {
                        const v = averageMetric(ragBaseline, "composite_avg");
                        return v === null ? "-" : v.toFixed(2);
                      })()}
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-dashed">
                  <CardHeader className="pb-2">
                    <CardDescription className="flex items-center gap-1">
                      <Activity className="h-4 w-4" />
                      {t("rag.baseline.evalRuns")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold">
                      {ragBaseline.reduce((sum, r) => sum + r.n_runs, 0)}
                    </p>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Run Status Breakdown */}
      {runSummary && Object.keys(runSummary.by_status).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("admin.aiObservability.runsByStatus")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(runSummary.by_status).map(([status, count]) => (
                <Badge
                  key={status}
                  variant={
                    status === "success"
                      ? "default"
                      : status === "failed"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {status}: {count}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Agent Metrics Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            {t("admin.aiObservability.agentMetrics")}
          </CardTitle>
          <CardDescription>
            {t("admin.aiObservability.agentMetricsDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {metricsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !metrics || metrics.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {t("admin.aiObservability.noMetrics")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 font-medium">
                      {t("admin.aiObservability.agent")}
                    </th>
                    <th className="pb-2 font-medium text-right">
                      {t("admin.aiObservability.events")}
                    </th>
                    <th className="pb-2 font-medium text-right">
                      {t("admin.aiObservability.avgLatency")}
                    </th>
                    <th className="pb-2 font-medium text-right">
                      {t("admin.aiObservability.p95Latency")}
                    </th>
                    <th className="pb-2 font-medium text-right">
                      <span className="flex items-center gap-1 justify-end">
                        <DollarSign className="h-3 w-3" />
                        {t("admin.aiObservability.cost")}
                      </span>
                    </th>
                    <th className="pb-2 font-medium text-right">
                      {t("admin.aiObservability.tokens")}
                    </th>
                    <th className="pb-2 font-medium text-right">
                      {t("admin.aiObservability.errorRate")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((row) => (
                    <tr key={row.agent_slug} className="border-b last:border-0">
                      <td className="py-2 font-mono text-xs">
                        {row.agent_slug}
                      </td>
                      <td className="py-2 text-right">{row.total_events}</td>
                      <td className="py-2 text-right">
                        {formatMs(row.avg_latency_ms)}
                      </td>
                      <td className="py-2 text-right">
                        {formatMs(row.p95_latency_ms)}
                      </td>
                      <td className="py-2 text-right">
                        {formatCost(row.total_cost)}
                      </td>
                      <td className="py-2 text-right">
                        {formatTokens(row.total_tokens)}
                      </td>
                      <td className="py-2 text-right">
                        <Badge
                          variant={
                            row.error_rate_pct > 10
                              ? "destructive"
                              : row.error_rate_pct > 5
                                ? "secondary"
                                : "default"
                          }
                        >
                          {row.error_rate_pct.toFixed(1)}%
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Run Kinds Breakdown */}
      {runSummary && Object.keys(runSummary.by_kind).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("admin.aiObservability.runsByKind")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(runSummary.by_kind).map(([kind, count]) => (
                <Badge key={kind} variant="outline">
                  {kind}: {count}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Orchestration-decision lens: why each model was chosen + estimated-vs-actual cost */}
      <DecisionLensCard />
    </div>
  );
}
