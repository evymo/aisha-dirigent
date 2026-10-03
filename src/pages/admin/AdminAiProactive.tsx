/**
 * Admin page for AI Proactive Triggers, Scheduled Jobs & Monitoring Config.
 *
 * Displays:
 * - Summary cards (total triggers, active, scheduled jobs, runs)
 * - Trigger definitions list with toggle (is_active), expandable conditions
 * - Proactive trigger run history
 * - Scheduled jobs list with cron, last/next run, success rate
 * - Monitoring configuration panel (health monitor toggle & interval)
 *
 * @module pages/admin/AdminAiProactive
 */

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Zap,
  Clock,
  Play,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Power,
  Trash2,
  Calendar,
  Target,
  Activity,
  Settings,
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
import { Switch } from "@/components/ui/switch";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePermissions } from "@/hooks/usePermissions";
import {
  useMonitoringConfig,
  useUpdateMonitoringConfig,
  INTERVAL_OPTIONS,
} from "@/hooks/useMonitoringConfig";
import type { MonitoringConfig } from "@/hooks/useMonitoringConfig";
import {
  useAiTriggers,
  useUpdateAiTrigger,
  useDeleteAiTrigger,
  useProactiveRuns,
  useAiScheduledJobs,
} from "@/hooks/useAiProactive";
import type { TriggerDefinition, ProactiveRun, ScheduledJob } from "@/hooks/useAiProactive";

// ============================================================================
// Helpers
// ============================================================================

type TabKey = "triggers" | "runs" | "jobs" | "monitoring";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function priorityVariant(priority: string): "default" | "secondary" | "destructive" | "outline" {
  switch (priority) {
    case "critical": return "destructive";
    case "high": return "default";
    case "normal": return "secondary";
    default: return "outline";
  }
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed": return "default";
    case "running": return "secondary";
    case "failed": return "destructive";
    case "cooldown": return "outline";
    case "skipped": return "outline";
    default: return "outline";
  }
}

// ============================================================================
// Sub-components
// ============================================================================

function TriggerRow({
  trigger,
  canManage,
}: {
  trigger: TriggerDefinition;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { mutate: updateTrigger, isPending: updating } = useUpdateAiTrigger();
  const { mutate: deleteTrigger, isPending: deleting } = useDeleteAiTrigger();

  const handleToggle = (checked: boolean) => {
    updateTrigger({ trigger_id: trigger.id, is_active: checked });
  };

  const handleDelete = () => {
    if (window.confirm(t("admin.aiProactive.triggers.confirmDelete"))) {
      deleteTrigger(trigger.id);
    }
  };

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
        <TableCell className="font-medium">{trigger.display_name ?? trigger.name}</TableCell>
        <TableCell>
          <code className="text-xs bg-muted px-1 py-0.5 rounded">{trigger.source_table}</code>
        </TableCell>
        <TableCell>
          <Badge variant="outline">{trigger.source_event}</Badge>
        </TableCell>
        <TableCell>
          <Badge variant="secondary">
            {t(`admin.aiProactive.actionType.${trigger.action_type}`, trigger.action_type)}
          </Badge>
        </TableCell>
        <TableCell>
          <Badge variant={priorityVariant(trigger.priority)}>
            {t(`admin.aiProactive.priority.${trigger.priority}`, trigger.priority)}
          </Badge>
        </TableCell>
        <TableCell>
          <span className="text-xs text-muted-foreground">
            {t("admin.aiProactive.triggers.cooldownMinutes", { value: trigger.cooldown_minutes })}
          </span>
        </TableCell>
        <TableCell>
          {canManage ? (
            <Switch
              checked={trigger.is_active}
              onCheckedChange={handleToggle}
              disabled={updating}
            />
          ) : (
            <Badge variant={trigger.is_active ? "default" : "outline"}>
              {trigger.is_active ? "ON" : "OFF"}
            </Badge>
          )}
        </TableCell>
        <TableCell>
          {canManage && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </TableCell>
      </TableRow>
      <CollapsibleContent asChild>
        <TableRow>
          <TableCell colSpan={9} className="bg-muted/30 p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">{t("admin.aiProactive.triggers.condition")}:</span>
                <pre className="mt-1 text-xs bg-muted p-2 rounded overflow-x-auto max-w-sm">
                  {JSON.stringify(trigger.condition, null, 2)}
                </pre>
              </div>
              <div className="space-y-2">
                <div>
                  <span className="text-muted-foreground">{t("admin.aiProactive.triggers.agentName")}:</span>{" "}
                  <span>{trigger.agent_name ?? "-"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("admin.aiProactive.triggers.workflowName")}:</span>{" "}
                  <span>{trigger.workflow_name ?? "-"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("admin.aiProactive.triggers.targetRoles")}:</span>{" "}
                  <span>{trigger.target_roles?.join(", ") ?? "-"}</span>
                </div>
              </div>
              <div>
                <span className="text-muted-foreground">{t("admin.aiProactive.triggers.name")}:</span>{" "}
                <code className="text-xs">{trigger.name}</code>
                <div className="mt-2 text-xs text-muted-foreground">{trigger.description}</div>
              </div>
            </div>
          </TableCell>
        </TableRow>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ProactiveRunsTable({ runs }: { runs: ProactiveRun[] }) {
  const { t } = useTranslation();

  if (!runs.length) {
    return (
      <div className="text-center py-8">
        <Play className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <p className="text-muted-foreground">{t("admin.aiProactive.runs.empty")}</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("admin.aiProactive.runs.triggerName")}</TableHead>
          <TableHead>{t("admin.aiProactive.runs.status")}</TableHead>
          <TableHead>{t("admin.aiProactive.runs.actionTaken")}</TableHead>
          <TableHead>{t("admin.aiProactive.runs.outputText")}</TableHead>
          <TableHead>{t("admin.aiProactive.runs.duration")}</TableHead>
          <TableHead>{t("admin.aiProactive.runs.tokens")}</TableHead>
          <TableHead>{t("common.createdAt")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id}>
            <TableCell className="font-medium">{run.trigger_name ?? run.trigger_definition_id.slice(0, 8)}</TableCell>
            <TableCell>
              <Badge variant={statusVariant(run.status)}>
                {t(`admin.aiProactive.status.${run.status}`, run.status)}
              </Badge>
            </TableCell>
            <TableCell className="text-xs">{run.action_taken ?? "-"}</TableCell>
            <TableCell className="max-w-[200px] truncate text-xs">{run.output_text ?? "-"}</TableCell>
            <TableCell className="text-xs">{run.duration_ms != null ? `${run.duration_ms}ms` : "-"}</TableCell>
            <TableCell className="text-xs">
              {(run.tokens_input ?? 0) + (run.tokens_output ?? 0) > 0
                ? `${run.tokens_input ?? 0}/${run.tokens_output ?? 0}`
                : "-"}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">{formatDate(run.created_at)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ScheduledJobsTable({ jobs, t }: { jobs: ScheduledJob[]; t: (key: string) => string }) {
  if (!jobs.length) {
    return (
      <div className="text-center py-8">
        <Calendar className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <p className="text-muted-foreground">{t("admin.aiProactive.jobs.empty")}</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("admin.aiProactive.jobs.name")}</TableHead>
          <TableHead>{t("admin.aiProactive.jobs.cronExpression")}</TableHead>
          <TableHead>{t("admin.aiProactive.jobs.jobType")}</TableHead>
          <TableHead>{t("admin.aiProactive.jobs.active")}</TableHead>
          <TableHead>{t("admin.aiProactive.jobs.lastRun")}</TableHead>
          <TableHead>{t("admin.aiProactive.jobs.lastStatus")}</TableHead>
          <TableHead>{t("admin.aiProactive.jobs.nextRun")}</TableHead>
          <TableHead>{t("admin.aiProactive.jobs.totalRuns")}</TableHead>
          <TableHead>{t("admin.aiProactive.jobs.successRate")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => {
          const successRate =
            (job.total_runs ?? 0) > 0
              ? (((job.successful_runs ?? 0) / (job.total_runs ?? 1)) * 100).toFixed(0)
              : "-";
          return (
            <TableRow key={job.id}>
              <TableCell className="font-medium">{job.display_name ?? job.name}</TableCell>
              <TableCell>
                <code className="text-xs bg-muted px-1 py-0.5 rounded">{job.cron_expression}</code>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{job.job_type}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant={job.is_active ? "default" : "outline"}>
                  {job.is_active ? "ON" : "OFF"}
                </Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{formatDate(job.last_run_at)}</TableCell>
              <TableCell>
                {job.last_run_status ? (
                  <Badge variant={statusVariant(job.last_run_status)}>
                    {job.last_run_status}
                  </Badge>
                ) : (
                  "-"
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{formatDate(job.next_run_at)}</TableCell>
              <TableCell className="text-center">{job.total_runs ?? 0}</TableCell>
              <TableCell className="text-center">{successRate === "-" ? "-" : `${successRate}%`}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ============================================================================
// Monitoring Panel
// ============================================================================

function MonitoringPanel({
  config,
  isLoading,
  canManage,
  onUpdate,
  isUpdating,
}: {
  config: MonitoringConfig | undefined;
  isLoading: boolean;
  canManage: boolean;
  onUpdate: (config: MonitoringConfig) => void;
  isUpdating: boolean;
}) {
  const { t } = useTranslation();

  const enabled = config?.health_enabled ?? true;
  const interval = config?.health_interval_minutes ?? 60;

  const handleToggle = useCallback(
    (checked: boolean) => {
      if (!config) return;
      onUpdate({ ...config, health_enabled: checked });
    },
    [config, onUpdate],
  );

  const handleIntervalChange = useCallback(
    (value: string) => {
      if (!config) return;
      onUpdate({ ...config, health_interval_minutes: Number(value) });
    },
    [config, onUpdate],
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Health Monitor Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-green-500" />
              <CardTitle className="text-base">
                {t("admin.aiProactive.monitoring.healthMonitor.title")}
              </CardTitle>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={handleToggle}
              disabled={!canManage || isUpdating}
              aria-label={t("admin.aiProactive.monitoring.healthMonitor.toggleLabel")}
            />
          </div>
          <CardDescription>
            {t("admin.aiProactive.monitoring.healthMonitor.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {t("admin.aiProactive.monitoring.healthMonitor.interval")}
              </span>
            </div>
            <Select
              value={String(interval)}
              onValueChange={handleIntervalChange}
              disabled={!canManage || isUpdating || !enabled}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVAL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Status indicator */}
          <div className="mt-4 flex items-center gap-2 text-sm">
            <div
              className={`h-2 w-2 rounded-full ${enabled ? "bg-green-500 animate-pulse" : "bg-muted-foreground"}`}
            />
            <span className="text-muted-foreground">
              {enabled
                ? t("admin.aiProactive.monitoring.healthMonitor.statusActive")
                : t("admin.aiProactive.monitoring.healthMonitor.statusInactive")}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Info banner */}
      <Alert>
        <Settings className="h-4 w-4" />
        <AlertDescription>
          {t("admin.aiProactive.monitoring.infoNote")}
        </AlertDescription>
      </Alert>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function AdminAiProactive() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  const canManage = hasPermission("manage_agents");

  const { data: triggers, isLoading: triggersLoading, error: triggersError } = useAiTriggers();
  const { data: runs, isLoading: runsLoading } = useProactiveRuns({ limit: 50 });
  const { data: jobs, isLoading: jobsLoading } = useAiScheduledJobs();
  const { data: monitoringConfig, isLoading: monitoringLoading } = useMonitoringConfig();
  const { mutate: updateMonitoring, isPending: monitoringUpdating } = useUpdateMonitoringConfig();

  const [activeTab, setActiveTab] = useState<TabKey>("triggers");

  if (!canView) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>{t("common.permissionDenied")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  // Summary stats
  const totalTriggers = triggers?.length ?? 0;
  const activeTriggers = triggers?.filter((tr) => tr.is_active).length ?? 0;
  const totalJobs = jobs?.length ?? 0;
  const totalRuns = runs?.length ?? 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Zap className="h-6 w-6" />
          {t("admin.aiProactive.title")}
        </h1>
        <p className="text-muted-foreground mt-1">
          {t("admin.aiProactive.description")}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.aiProactive.summaryCards.totalTriggers")}</CardDescription>
          </CardHeader>
          <CardContent>
            {triggersLoading ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-2xl font-bold flex items-center gap-2">
                <Target className="h-5 w-5 text-muted-foreground" />
                {totalTriggers}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.aiProactive.summaryCards.activeTriggers")}</CardDescription>
          </CardHeader>
          <CardContent>
            {triggersLoading ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-2xl font-bold flex items-center gap-2">
                <Power className="h-5 w-5 text-green-500" />
                {activeTriggers}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.aiProactive.summaryCards.totalJobs")}</CardDescription>
          </CardHeader>
          <CardContent>
            {jobsLoading ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-2xl font-bold flex items-center gap-2">
                <Clock className="h-5 w-5 text-blue-500" />
                {totalJobs}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.aiProactive.summaryCards.totalRuns")}</CardDescription>
          </CardHeader>
          <CardContent>
            {runsLoading ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-2xl font-bold flex items-center gap-2">
                <Play className="h-5 w-5 text-muted-foreground" />
                {totalRuns}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tab Buttons */}
      <div className="flex gap-2">
        <Button
          variant={activeTab === "triggers" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("triggers")}
        >
          <Zap className="h-4 w-4 mr-1" />
          {t("admin.aiProactive.tabs.triggers")}
          {totalTriggers > 0 && <Badge variant="secondary" className="ml-2">{totalTriggers}</Badge>}
        </Button>
        <Button
          variant={activeTab === "runs" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("runs")}
        >
          <Play className="h-4 w-4 mr-1" />
          {t("admin.aiProactive.tabs.runs")}
          {totalRuns > 0 && <Badge variant="secondary" className="ml-2">{totalRuns}</Badge>}
        </Button>
        <Button
          variant={activeTab === "jobs" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("jobs")}
        >
          <Calendar className="h-4 w-4 mr-1" />
          {t("admin.aiProactive.tabs.jobs")}
          {totalJobs > 0 && <Badge variant="secondary" className="ml-2">{totalJobs}</Badge>}
        </Button>
        <Button
          variant={activeTab === "monitoring" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("monitoring")}
        >
          <Activity className="h-4 w-4 mr-1" />
          {t("admin.aiProactive.tabs.monitoring")}
        </Button>
      </div>

      {/* Error */}
      {triggersError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{t("admin.aiProactive.errorLoading")}</AlertDescription>
        </Alert>
      )}

      {/* Trigger Definitions Tab */}
      {activeTab === "triggers" && (
        <Card>
          <CardHeader>
            <CardTitle>{t("admin.aiProactive.triggers.title")}</CardTitle>
            <CardDescription>{t("admin.aiProactive.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            {triggersLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : !triggers?.length ? (
              <div className="text-center py-8">
                <Zap className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">{t("admin.aiProactive.triggers.empty")}</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>{t("admin.aiProactive.triggers.displayName")}</TableHead>
                    <TableHead>{t("admin.aiProactive.triggers.sourceTable")}</TableHead>
                    <TableHead>{t("admin.aiProactive.triggers.sourceEvent")}</TableHead>
                    <TableHead>{t("admin.aiProactive.triggers.actionType")}</TableHead>
                    <TableHead>{t("admin.aiProactive.triggers.priority")}</TableHead>
                    <TableHead>{t("admin.aiProactive.triggers.cooldown")}</TableHead>
                    <TableHead>{t("admin.aiProactive.triggers.active")}</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {triggers.map((trigger) => (
                    <TriggerRow key={trigger.id} trigger={trigger} canManage={canManage} />
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Trigger Runs Tab */}
      {activeTab === "runs" && (
        <Card>
          <CardHeader>
            <CardTitle>{t("admin.aiProactive.runs.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            {runsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <ProactiveRunsTable runs={runs ?? []} />
            )}
          </CardContent>
        </Card>
      )}

      {/* Scheduled Jobs Tab */}
      {activeTab === "jobs" && (
        <Card>
          <CardHeader>
            <CardTitle>{t("admin.aiProactive.jobs.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            {jobsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <ScheduledJobsTable jobs={jobs ?? []} t={t} />
            )}
          </CardContent>
        </Card>
      )}

      {/* Monitoring Config Tab */}
      {activeTab === "monitoring" && (
        <MonitoringPanel
          config={monitoringConfig}
          isLoading={monitoringLoading}
          canManage={canManage}
          onUpdate={updateMonitoring}
          isUpdating={monitoringUpdating}
        />
      )}
    </div>
  );
}
