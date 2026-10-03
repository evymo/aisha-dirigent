/**
 * LiveAgentsStrip — mission-control pane showing currently-running ai_runs.
 *
 * Each card surfaces: agent slug, kind, story title (or "system"), elapsed
 * time, current step, step count. A live green dot pulses while the run is
 * still active. Subscribes to ai_runs for instant updates.
 */
import { useTranslation } from "react-i18next";
import { Bot, Clock, Package, Ban } from "lucide-react";
import { toast } from "sonner";

import { useLiveAgentRuns, type ActiveAgentRun } from "@/hooks/useMissionControl";
import { useCancelAiRun } from "@/hooks/useMissionControlActions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function LiveAgentsStrip() {
  const { t } = useTranslation();
  const { data: runs = [], isLoading, error } = useLiveAgentRuns({ limit: 10 });

  return (
    <Card data-test="mc-live-agents-strip">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="size-4" aria-hidden="true" />
          {t("missionControl.liveAgents.title", "Live agents")}
          <Badge variant="outline" className="ml-auto text-[10px]">
            {runs.length}
          </Badge>
        </CardTitle>
        <CardDescription>
          {t(
            "missionControl.liveAgents.subtitle",
            "AISHA runs that are executing right now.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <Skeleton className="h-16" />}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{(error as Error).message}</AlertDescription>
          </Alert>
        )}
        {!isLoading && runs.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("missionControl.liveAgents.empty", "No agents running.")}
          </p>
        )}
        {runs.map((run) => (
          <div
            key={run.run_id}
            data-test={`live-agent-${run.run_id}`}
            className="flex items-center gap-2 rounded border bg-muted/30 p-2 text-sm"
          >
            <span
              className="size-2 animate-pulse rounded-full bg-emerald-500"
              aria-label={t("missionControl.liveAgents.running", "Running")}
            />
            <div className="flex-1 truncate">
              <div className="flex items-center gap-2">
                <span className="font-medium">{run.current_agent_slug}</span>
                {run.is_stack_default && (
                  <Package className="size-3 text-primary" aria-hidden="true" />
                )}
                <Badge variant="outline" className="text-[10px] font-normal">
                  {run.kind}
                </Badge>
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {run.current_step ?? t("missionControl.liveAgents.starting", "Starting…")}
                {run.story_title ? ` · ${run.story_title}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="size-3" aria-hidden="true" />
              {formatElapsed(run.elapsed_ms)}
            </div>
            <CancelRunButton run={run} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * CancelRunButton — confirm-gated stop for a live run. The cancel_ai_run RPC
 * enforces admin/staff-or-owner authorization and records the action (incl.
 * on-behalf-of impersonation) in the audit journal; this is only the affordance.
 */
function CancelRunButton({ run }: { run: ActiveAgentRun }) {
  const { t } = useTranslation();
  const cancelRun = useCancelAiRun();

  const handleConfirm = () => {
    cancelRun.mutate(
      { runId: run.run_id },
      {
        onSuccess: () =>
          toast.success(t("missionControl.liveAgents.cancelled", "Run cancelled.")),
        onError: () => toast.error(t("common.error", "Something went wrong.")),
      },
    );
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 text-muted-foreground hover:text-destructive"
          title={t("missionControl.liveAgents.cancelTooltip", "Cancel run")}
          disabled={cancelRun.isPending}
        >
          <Ban className="size-3.5" aria-hidden="true" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("missionControl.liveAgents.cancelTitle", "Cancel this run?")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("missionControl.liveAgents.cancelConfirm", {
              defaultValue:
                'Stop "{{agent}}"? This halts the run and is recorded in the audit journal.',
              agent: run.current_agent_slug ?? run.kind,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {t("missionControl.liveAgents.cancelConfirmAction", "Cancel run")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}
