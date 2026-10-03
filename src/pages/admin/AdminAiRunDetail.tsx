/**
 * Admin run detail page — shows full timeline of trace events for a single AI run.
 *
 * @module pages/admin/AdminAiRunDetail
 */

import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Clock,
  Cpu,
  Zap,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Timer,
  SkipForward,
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
import { usePermissions } from "@/hooks/usePermissions";
import { useAiRuns, useAiRunEvents } from "@/hooks/useAiRuns";
import type { AiTraceEventRow } from "@/lib/schemas/expertOverlaySchemas";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_ICONS: Record<string, typeof CheckCircle2> = {
  ok: CheckCircle2,
  error: XCircle,
  timeout: Timer,
  skipped: SkipForward,
};

const STATUS_COLORS: Record<string, string> = {
  ok: "text-green-600",
  error: "text-destructive",
  timeout: "text-amber-600",
  skipped: "text-muted-foreground",
};

function badgeVariant(status: string) {
  switch (status) {
    case "succeeded":
    case "ok":
      return "default" as const;
    case "failed":
    case "error":
      return "destructive" as const;
    case "running":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

function formatMs(ms: number | null | undefined): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminAiRunDetail() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");

  const { data: runs } = useAiRuns({ limit: 1 });
  const run = runs?.find((r) => r.id === runId);

  const {
    data: events,
    isLoading: eventsLoading,
    error: eventsError,
  } = useAiRunEvents(runId);

  if (!canView) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>{t("common.noPermission")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/admin/ai-runs")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Cpu className="h-6 w-6" />
            {t("admin.aiRunDetail.title")}
          </h1>
          <p className="text-muted-foreground text-sm font-mono">
            {runId}
          </p>
        </div>
      </div>

      {/* Run summary card */}
      {run && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">{t("admin.aiRunDetail.summary")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">{t("admin.aiRunDetail.status")}</span>
                <div className="mt-1">
                  <Badge variant={badgeVariant(run.status)}>{run.status}</Badge>
                </div>
              </div>
              <div>
                <span className="text-muted-foreground">{t("admin.aiRunDetail.kind")}</span>
                <div className="mt-1 font-mono">{run.kind}</div>
              </div>
              <div>
                <span className="text-muted-foreground">{t("admin.aiRunDetail.started")}</span>
                <div className="mt-1">{new Date(run.started_at).toLocaleString()}</div>
              </div>
              <div>
                <span className="text-muted-foreground">{t("admin.aiRunDetail.duration")}</span>
                <div className="mt-1">
                  {run.finished_at
                    ? formatMs(new Date(run.finished_at).getTime() - new Date(run.started_at).getTime())
                    : t("admin.aiRunDetail.running")}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Trace events timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            {t("admin.aiRunDetail.traceTimeline")}
          </CardTitle>
          <CardDescription>
            {events?.length ?? 0} {t("admin.aiRunDetail.events")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {eventsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : eventsError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{t("admin.aiRunDetail.loadError")}</AlertDescription>
            </Alert>
          ) : !events || events.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {t("admin.aiRunDetail.noEvents")}
            </p>
          ) : (
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

              <div className="space-y-4">
                {events.map((evt, idx) => (
                  <TraceEventCard key={evt.id} event={evt} index={idx} />
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TraceEventCard
// ---------------------------------------------------------------------------

function TraceEventCard({ event: evt, index }: { event: AiTraceEventRow; index: number }) {
  const StatusIcon = STATUS_ICONS[evt.status] ?? AlertCircle;
  const statusColor = STATUS_COLORS[evt.status] ?? "text-muted-foreground";

  return (
    <div className="relative flex gap-4 pl-2">
      {/* Timeline dot */}
      <div className="flex-shrink-0 z-10 mt-1">
        <div className={`h-5 w-5 rounded-full border-2 bg-background flex items-center justify-center ${statusColor}`}>
          <StatusIcon className="h-3 w-3" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 border rounded-lg p-3 bg-card">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs">
              {evt.event_type}
            </Badge>
            {evt.agent_slug && (
              <span className="text-sm font-medium">{evt.agent_slug}</span>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {evt.duration_ms != null && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatMs(evt.duration_ms)}
              </span>
            )}
            <span className="font-mono">#{index + 1}</span>
          </div>
        </div>

        {/* Provider + operation */}
        {(evt.provider || evt.operation) && (
          <div className="text-xs text-muted-foreground mt-1 font-mono">
            {[evt.provider, evt.operation].filter(Boolean).join(" / ")}
          </div>
        )}

        {/* Runtime / executor axis — which runtime ran the work (decision_id →
            ai_decisions.runtime), next to the provider (cloud) axis. The Cpu icon
            labels it with NO translatable string (i18n-clean); decision_id (a UUID)
            rides the title attribute. */}
        {(evt.backend_kind || evt.model_id) && (
          <div
            className="text-xs text-muted-foreground mt-1 font-mono flex items-center gap-1 flex-wrap"
            title={evt.decision_id ?? undefined}
          >
            <Cpu className="h-3 w-3 opacity-70" />
            {[evt.backend_kind, evt.model_id].filter(Boolean).join(" / ")}
          </div>
        )}

        {/* Error detail */}
        {evt.error_json && typeof evt.error_json === "object" && (
          <div className="mt-2 text-xs bg-destructive/10 text-destructive rounded p-2 font-mono break-all">
            {(evt.error_json as Record<string, unknown>).message as string ?? JSON.stringify(evt.error_json)}
          </div>
        )}

        {/* Cost JSON preview */}
        {evt.cost_json && typeof evt.cost_json === "object" && (
          <div className="mt-2 text-xs bg-muted rounded p-2 font-mono break-all">
            {JSON.stringify(evt.cost_json)}
          </div>
        )}
      </div>
    </div>
  );
}
