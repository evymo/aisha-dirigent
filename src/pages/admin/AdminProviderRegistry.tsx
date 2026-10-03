/**
 * Admin page for managing the AI Provider Registry.
 * Browse providers (anthropic, openai, google-genai, llmgateway-io, ollama, ...),
 * inspect periodic health-probe results, and toggle is_enabled.
 *
 * After PR #79 (WF_PROVIDER_HEALTH_PROBE), `last_health_status` updates
 * automatically every 5 min. After PR #81 (WF_MCP_PROBE), the parallel
 * MCP registry is similarly auto-maintained.
 *
 * Operator can disable a provider when:
 *   - It's degraded/down for too long (rather than waiting for resolver to
 *     deprioritize on score)
 *   - Cost spike or policy reason (e.g. temporarily disable a premium
 *     provider while running a budget-only A/B)
 *   - Provider deprecation (will be removed in a future migration)
 *
 * Disabling does NOT delete the row — the seed is reapplied on each
 * migration run with ON CONFLICT DO UPDATE preserving operator's
 * is_enabled choice.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ServerCog, RefreshCw, Activity, AlertTriangle, ShieldOff, HelpCircle, RotateCcw } from "lucide-react";
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
  useProviderRegistry,
  useUpdateProvider,
  type ProviderRegistryRow,
} from "@/hooks/useProviderRegistry";

/** Maps last_health_status to badge color. */
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

/** Health status icon. */
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

export default function AdminProviderRegistry() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("view_admin_dashboard");

  const [backendFilter, setBackendFilter] = useState<string>("all");
  const [enabledOnly, setEnabledOnly] = useState(false);

  const { data: providers, isLoading, refetch } = useProviderRegistry({
    backendKind: backendFilter === "all" ? undefined : backendFilter,
    enabledOnly,
  });

  const updateProvider = useUpdateProvider();

  const handleToggleEnabled = async (provider: ProviderRegistryRow) => {
    try {
      await updateProvider.mutateAsync({
        providerId: provider.id,
        isEnabled: !provider.is_enabled,
      });
      toast.success(
        provider.is_enabled
          ? t("admin.providerRegistry.disabledMessage", { provider: provider.slug })
          : t("admin.providerRegistry.enabledMessage", { provider: provider.slug }),
      );
    } catch {
      toast.error(t("common.error"));
    }
  };

  // Operator-initiated reset of consecutive_failure_count → 0. This pulls the
  // provider out of probe backoff (1h/6h/24h) and back to base 5-min cadence.
  // Used after operator confirms a chronic-down provider is fixed.
  const handleResetFailureCount = async (provider: ProviderRegistryRow) => {
    try {
      await updateProvider.mutateAsync({
        providerId: provider.id,
        resetFailureCount: true,
      });
      toast.success(t("admin.providerRegistry.failureCountResetMessage", { provider: provider.slug }));
    } catch {
      toast.error(t("common.error"));
    }
  };

  // Derive unique backend_kinds from data for the filter dropdown
  const backendKinds = Array.from(new Set((providers ?? []).map((p) => p.backend_kind))).sort();

  // Summary stats
  const total = providers?.length ?? 0;
  const enabled = providers?.filter((p) => p.is_enabled).length ?? 0;
  const healthy = providers?.filter((p) => p.last_health_status === "healthy").length ?? 0;
  const degraded = providers?.filter((p) => p.last_health_status === "degraded").length ?? 0;
  const down = providers?.filter((p) => p.last_health_status === "down").length ?? 0;

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
            <ServerCog className="h-8 w-8" />
            {t("admin.providerRegistry.title")}
          </h1>
          <p className="text-muted-foreground mt-2">
            {t("admin.providerRegistry.description")}
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
            <CardDescription>{t("admin.providerRegistry.total")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.providerRegistry.enabled")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{enabled}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.providerRegistry.healthy")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{healthy}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.providerRegistry.degraded")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{degraded}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.providerRegistry.down")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{down}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.providerRegistry.filters")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label>{t("admin.providerRegistry.backendKind")}</Label>
              <Select value={backendFilter} onValueChange={setBackendFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common.all")}</SelectItem>
                  {backendKinds.map((k) => (
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
                {t("admin.providerRegistry.enabledOnly")}
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Providers list */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.providerRegistry.providers", { count: total })}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-3 pr-4 font-medium">{t("admin.providerRegistry.slug")}</th>
                  <th className="pb-3 pr-4 font-medium">{t("admin.providerRegistry.backendKind")}</th>
                  <th className="pb-3 pr-4 font-medium">{t("admin.providerRegistry.health")}</th>
                  <th className="pb-3 pr-4 font-medium">{t("admin.providerRegistry.lastChecked")}</th>
                  <th className="pb-3 pr-4 font-medium">{t("admin.providerRegistry.failures")}</th>
                  <th className="pb-3 pr-4 font-medium">{t("admin.providerRegistry.capabilities")}</th>
                  <th className="pb-3 pr-4 font-medium">{t("admin.providerRegistry.cost")}</th>
                  <th className="pb-3 pr-4 font-medium">{t("admin.providerRegistry.enabledColumn")}</th>
                </tr>
              </thead>
              <tbody>
                {(providers ?? []).map((p) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="py-3 pr-4">
                      <div className="font-mono text-xs font-semibold">{p.slug}</div>
                      <div className="text-muted-foreground text-xs">{p.display_name}</div>
                    </td>
                    <td className="py-3 pr-4 text-xs font-mono">{p.backend_kind}</td>
                    <td className="py-3 pr-4">
                      <Badge variant={healthBadgeVariant(p.last_health_status)} className="gap-1">
                        <HealthIcon status={p.last_health_status} />
                        {p.last_health_status}
                      </Badge>
                      {p.last_health_detail ? (
                        <div className="text-muted-foreground text-xs mt-1 max-w-[200px] truncate" title={p.last_health_detail}>
                          {p.last_health_detail}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4 text-xs text-muted-foreground">
                      {timeAgo(p.last_health_checked_at, t)}
                    </td>
                    <td className="py-3 pr-4">
                      {p.consecutive_failure_count > 0 ? (
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={p.consecutive_failure_count >= 5 ? "destructive" : "secondary"}
                            className="text-xs"
                            title={t("admin.providerRegistry.failureCountHint", { count: p.consecutive_failure_count })}
                          >
                            {p.consecutive_failure_count}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2"
                            onClick={() => handleResetFailureCount(p)}
                            disabled={updateProvider.isPending}
                            aria-label={t("admin.providerRegistry.resetFailureCount", { slug: p.slug })}
                            title={t("admin.providerRegistry.resetFailureCount", { slug: p.slug })}
                          >
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex gap-1 flex-wrap">
                        {p.supports_tool_use ? <Badge variant="outline" className="text-xs">{t("admin.providerRegistry.tools")}</Badge> : null}
                        {p.supports_vision ? <Badge variant="outline" className="text-xs">{t("admin.providerRegistry.vision")}</Badge> : null}
                        {p.supports_batch ? <Badge variant="outline" className="text-xs">{t("admin.providerRegistry.batch")}</Badge> : null}
                        {p.supports_streaming ? <Badge variant="outline" className="text-xs">{t("admin.providerRegistry.streaming")}</Badge> : null}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <Badge variant="outline" className="text-xs">{p.cost_class ?? "—"}</Badge>
                    </td>
                    <td className="py-3 pr-4">
                      <Switch
                        checked={p.is_enabled}
                        onCheckedChange={() => handleToggleEnabled(p)}
                        disabled={updateProvider.isPending}
                        aria-label={t("admin.providerRegistry.toggleEnabled", { slug: p.slug })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {total === 0 ? (
              <div className="text-center text-muted-foreground py-12">
                {t("admin.providerRegistry.noProviders")}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
