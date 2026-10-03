/**
 * Admin page for managing the AI Runtime Registry — the runtime/executor axis
 * (direct_llm / openclaw / hermes / cli / workflow / human), the co-equal sibling
 * of AdminProviderRegistry + AdminModelRegistry.
 *
 * Operators see which runtimes are enabled + healthy (adapter_health from
 * WF_RUNTIME_HEALTH_PROBE) and their declared capabilities, and toggle is_enabled.
 * fn_resolve_runtime derives the executor from exactly these rows, so disabling a
 * runtime here removes it from selection (a confirmed-down one is already excluded).
 *
 * Disabling does NOT delete the seed row — the operator's is_enabled choice is
 * preserved across migrations (ON CONFLICT DO UPDATE).
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Cpu, RefreshCw, Activity, AlertTriangle, ShieldOff, HelpCircle, Pencil, Globe, Wrench } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import {
  useRuntimeRegistry,
  useUpdateRuntime,
  type RuntimeRegistryRow,
} from "@/hooks/useRuntimeRegistry";

/** Maps adapter_health to badge color. */
function healthBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "healthy":
      return "default";
    case "degraded":
      return "secondary";
    case "down":
      return "destructive";
    default:
      return "outline";
  }
}

/** adapter_health icon. */
function HealthIcon({ status }: { status: string }) {
  switch (status) {
    case "healthy":
      return <Activity className="h-3.5 w-3.5" />;
    case "degraded":
      return <AlertTriangle className="h-3.5 w-3.5" />;
    case "down":
      return <ShieldOff className="h-3.5 w-3.5" />;
    default:
      return <HelpCircle className="h-3.5 w-3.5" />;
  }
}

/** Format "X minutes ago" — keeps the UI live without a server roundtrip. */
function timeAgo(iso: string | null, t: (k: string, opts?: Record<string, unknown>) => string): string {
  if (!iso) return t("common.never");
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return t("common.justNow");
  if (diffSec < 3600) return t("common.minutesAgo", { count: Math.floor(diffSec / 60) });
  if (diffSec < 86400) return t("common.hoursAgo", { count: Math.floor(diffSec / 3600) });
  return t("common.daysAgo", { count: Math.floor(diffSec / 86400) });
}

export default function AdminRuntimeRegistry() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("view_admin_dashboard");

  const [kindFilter, setKindFilter] = useState<string>("all");
  const [enabledOnly, setEnabledOnly] = useState(false);

  const { data: runtimes, isLoading, refetch } = useRuntimeRegistry({
    runtimeKind: kindFilter === "all" ? undefined : kindFilter,
    enabledOnly,
  });

  const updateRuntime = useUpdateRuntime();

  const handleToggleEnabled = async (runtime: RuntimeRegistryRow) => {
    try {
      await updateRuntime.mutateAsync({
        slug: runtime.slug,
        isEnabled: !runtime.is_enabled,
      });
      toast.success(
        runtime.is_enabled
          ? t("admin.runtimeRegistry.disabledMessage", { runtime: runtime.slug })
          : t("admin.runtimeRegistry.enabledMessage", { runtime: runtime.slug }),
      );
    } catch {
      toast.error(t("common.error"));
    }
  };

  // Derive unique runtime_kinds from data for the filter dropdown
  const runtimeKinds = Array.from(new Set((runtimes ?? []).map((r) => r.runtime_kind))).sort();

  // Summary stats
  const total = runtimes?.length ?? 0;
  const enabled = runtimes?.filter((r) => r.is_enabled).length ?? 0;
  const healthy = runtimes?.filter((r) => r.adapter_health === "healthy").length ?? 0;
  const degraded = runtimes?.filter((r) => r.adapter_health === "degraded").length ?? 0;
  const down = runtimes?.filter((r) => r.adapter_health === "down").length ?? 0;

  if (!canManage) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>{t("common.permissionDenied")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Cpu className="h-8 w-8" />
            {t("admin.runtimeRegistry.title")}
          </h1>
          <p className="text-muted-foreground mt-2">
            {t("admin.runtimeRegistry.description")}
          </p>
        </div>
        <Button onClick={() => refetch()} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          {t("common.refresh")}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.runtimeRegistry.total")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.runtimeRegistry.enabled")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{enabled}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.runtimeRegistry.healthy")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{healthy}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.runtimeRegistry.degraded")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{degraded}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.runtimeRegistry.down")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{down}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.runtimeRegistry.filters")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label>{t("admin.runtimeRegistry.runtimeKind")}</Label>
              <Select value={kindFilter} onValueChange={setKindFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common.all")}</SelectItem>
                  {runtimeKinds.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="enabled-only"
                checked={enabledOnly}
                onCheckedChange={setEnabledOnly}
              />
              <Label htmlFor="enabled-only" className="cursor-pointer">
                {t("admin.runtimeRegistry.enabledOnly")}
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Runtimes list */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.runtimeRegistry.runtimes", { count: total })}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-3 pr-4 font-medium">{t("admin.runtimeRegistry.runtime")}</th>
                  <th className="pb-3 pr-4 font-medium">{t("admin.runtimeRegistry.kind")}</th>
                  <th className="pb-3 pr-4 font-medium">{t("admin.runtimeRegistry.health")}</th>
                  <th className="pb-3 pr-4 font-medium">{t("admin.runtimeRegistry.lastChecked")}</th>
                  <th className="pb-3 pr-4 font-medium">{t("admin.runtimeRegistry.failures")}</th>
                  <th className="pb-3 pr-4 font-medium">{t("admin.runtimeRegistry.capabilities")}</th>
                  <th className="pb-3 pr-4 font-medium">{t("admin.runtimeRegistry.class")}</th>
                  <th className="pb-3 pr-4 font-medium">{t("admin.runtimeRegistry.enabledColumn")}</th>
                </tr>
              </thead>
              <tbody>
                {(runtimes ?? []).map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="py-3 pr-4">
                      <div className="font-mono text-xs font-semibold">{r.slug}</div>
                      <div className="text-muted-foreground text-xs">{r.display_name}</div>
                    </td>
                    <td className="py-3 pr-4 text-xs font-mono">{r.runtime_kind}</td>
                    <td className="py-3 pr-4">
                      <Badge variant={healthBadgeVariant(r.adapter_health)} className="gap-1">
                        <HealthIcon status={r.adapter_health} />
                        {r.adapter_health}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4 text-xs text-muted-foreground">
                      {timeAgo(r.adapter_health_checked_at, t)}
                    </td>
                    <td className="py-3 pr-4">
                      {r.consecutive_failure_count > 0 ? (
                        <Badge
                          variant={r.consecutive_failure_count >= 5 ? "destructive" : "secondary"}
                          className="text-xs"
                          title={t("admin.runtimeRegistry.failureCountHint", { count: r.consecutive_failure_count })}
                        >
                          {r.consecutive_failure_count}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex gap-1 flex-wrap">
                        {r.can_write ? (
                          <Badge variant="outline" className="text-xs gap-1">
                            <Pencil className="h-3 w-3" />
                            {t("admin.runtimeRegistry.write")}
                          </Badge>
                        ) : null}
                        {r.needs_network ? (
                          <Badge variant="outline" className="text-xs gap-1">
                            <Globe className="h-3 w-3" />
                            {t("admin.runtimeRegistry.network")}
                          </Badge>
                        ) : null}
                        {r.supports_tools ? (
                          <Badge variant="outline" className="text-xs gap-1">
                            <Wrench className="h-3 w-3" />
                            {t("admin.runtimeRegistry.tools")}
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-col gap-1">
                        <Badge variant="outline" className="text-xs font-mono">{r.side_effect_class}</Badge>
                        <Badge variant="outline" className="text-xs font-mono">{r.autonomy_class}</Badge>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <Switch
                        checked={r.is_enabled}
                        onCheckedChange={() => handleToggleEnabled(r)}
                        disabled={updateRuntime.isPending}
                        aria-label={t("admin.runtimeRegistry.toggleEnabled", { slug: r.slug })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {total === 0 ? (
              <div className="text-center text-muted-foreground py-12">
                {t("admin.runtimeRegistry.noRuntimes")}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
