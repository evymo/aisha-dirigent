/**
 * Admin page for monitoring AI runs.
 * View run history, trace events, and performance metrics.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Activity, RefreshCw, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { usePermissions } from "@/hooks/usePermissions";
import { useAiRuns, useAiRunEvents } from "@/hooks/useAiRuns";

export default function AdminAiRuns() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [showEvents, setShowEvents] = useState(false);

  const { data: runs, isLoading, refetch } = useAiRuns({ limit: 30 });
  const { data: events, isLoading: eventsLoading } = useAiRunEvents(selectedRunId ?? undefined);

  const formatDuration = (started: string, finished?: string | null) => {
    if (!finished) return "running...";
    const ms = new Date(finished).getTime() - new Date(started).getTime();
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "success": return "default";
      case "error": return "destructive";
      case "running": return "secondary";
      default: return "outline";
    }
  };

  if (!canView) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>{t("common.noPermission")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-8 w-8" />
            {t("admin.aiRuns.title")}
          </h1>
          <p className="text-muted-foreground mt-2">
            {t("admin.aiRuns.description")}
          </p>
        </div>
        <Button onClick={() => refetch()} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          {t("common.refresh")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("admin.aiRuns.recent")}</CardTitle>
          <CardDescription>
            {runs?.length ?? 0} {t("admin.aiRunDetail.events")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {runs?.map((run) => (
              <div key={run.id} className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant={statusColor(run.status)}>{run.status}</Badge>
                    <span className="font-mono text-sm">{run.kind}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(`/admin/ai-runs/${run.id}`)}
                      title={t("admin.aiRuns.openDetail")}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedRunId(run.id);
                        setShowEvents(!showEvents || selectedRunId !== run.id);
                      }}
                    >
                      {selectedRunId === run.id && showEvents ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="text-sm text-muted-foreground grid grid-cols-2 gap-2">
                  <div>{t("admin.aiRuns.agentValue", { value: (run.metadata.agent_slug as string | undefined) ?? "N/A" })}</div>
                  <div>{t("admin.aiRuns.durationValue", { value: formatDuration(run.started_at, run.finished_at) })}</div>
                  <div>{t("admin.aiRuns.startedValue", { value: new Date(run.started_at).toLocaleString() })}</div>
                  <div>{t("admin.aiRuns.loopsValue", { value: run.metadata.loop_count as number | undefined })}</div>
                </div>

                {selectedRunId === run.id && showEvents && (
                  <div className="mt-4 border-t pt-4">
                    <h4 className="font-semibold mb-2">
                      {t("admin.aiRuns.traceEvents")} ({events?.length ?? 0})
                    </h4>
                    {eventsLoading ? (
                      <Skeleton className="h-20" />
                    ) : events && events.length > 0 ? (
                      <div className="space-y-1 max-h-64 overflow-y-auto">
                        {events.map((evt) => (
                          <div key={evt.id} className="text-xs font-mono bg-muted p-2 rounded">
                            <span className="font-semibold">{evt.event_type}</span> - {evt.operation}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t("admin.aiRunDetail.noEvents")}</p>
                    )}
                  </div>
                )}
              </div>
            ))}

            {!runs || runs.length === 0 && (
              <Alert>
                <AlertDescription>{t("admin.aiRuns.empty")}</AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
