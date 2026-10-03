/**
 * Admin page for managing the MCP Server Registry.
 * Parallel to AdminProviderRegistry but for mcp_server_registry (aisha-
 * knowledge, huggingface-inference, github-mcp, ...).
 *
 * Operator can:
 *   - See current status (7-state lifecycle) + last test result
 *   - Transition status via state-machine-validated dropdown
 *   - Filter by transport (http/sse/stdio/websocket) and status
 *
 * Probe-driven transitions (tested_ok/tested_failed) come from
 * WF_MCP_PROBE (PR #81) every 5 min and bypass this UI — they're
 * authoritative for "did this server respond?". Operator transitions
 * (enabled, in_use, deprecated, rejected) require this UI.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plug, RefreshCw, AlertTriangle } from "lucide-react";
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
  useMcpRegistry,
  useUpdateMcpStatus,
  MCP_STATUSES,
  type McpRegistryRow,
  type McpStatus,
} from "@/hooks/useMcpRegistry";

/** Maps status to badge color. */
function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "in_use":
    case "enabled":
      return "default";
    case "tested_ok":
    case "discovered":
      return "secondary";
    case "tested_failed":
    case "rejected":
      return "destructive";
    case "deprecated":
      return "outline";
    default:
      return "outline";
  }
}

/** Format "X minutes ago" — matches AdminProviderRegistry pattern. */
function timeAgo(iso: string | null, t: (k: string, opts?: Record<string, unknown>) => string): string {
  if (!iso) return t("common.never");
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return t("common.justNow");
  if (diffSec < 3600) return t("common.minutesAgo", { count: Math.floor(diffSec / 60) });
  if (diffSec < 86400) return t("common.hoursAgo", { count: Math.floor(diffSec / 3600) });
  return t("common.daysAgo", { count: Math.floor(diffSec / 86400) });
}

export default function AdminMcpServerRegistry() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("view_admin_dashboard");

  const [transportFilter, setTransportFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [activeOnly, setActiveOnly] = useState(false);

  const { data: servers, isLoading, refetch } = useMcpRegistry({
    transport: transportFilter === "all" ? undefined : transportFilter,
    status: statusFilter === "all" ? undefined : statusFilter,
    activeOnly,
  });

  const updateStatus = useUpdateMcpStatus();

  const handleStatusChange = async (mcp: McpRegistryRow, newStatus: McpStatus) => {
    if (newStatus === mcp.status) return;
    try {
      await updateStatus.mutateAsync({
        mcpId: mcp.id,
        newStatus,
      });
      toast.success(
        t("admin.mcpRegistry.statusChanged", {
          slug: mcp.slug,
          from: mcp.status,
          to: newStatus,
        }),
      );
    } catch (err) {
      // Server returns explicit transition error — surface it to operator
      const msg = err instanceof Error ? err.message : t("common.error");
      toast.error(msg);
    }
  };

  // Derive unique transports for filter
  const transports = Array.from(new Set((servers ?? []).map((m) => m.transport))).sort();

  // Summary stats — count per lifecycle bucket
  const total = servers?.length ?? 0;
  const active = servers?.filter((m) => m.status === "in_use" || m.status === "enabled").length ?? 0;
  const tested = servers?.filter((m) => m.status === "tested_ok").length ?? 0;
  const failed = servers?.filter((m) => m.status === "tested_failed").length ?? 0;
  const retired = servers?.filter((m) => m.status === "deprecated" || m.status === "rejected").length ?? 0;

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
            <Plug className="h-8 w-8" />
            {t("admin.mcpRegistry.title")}
          </h1>
          <p className="text-muted-foreground mt-2">
            {t("admin.mcpRegistry.description")}
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
            <CardDescription>{t("admin.mcpRegistry.total")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.mcpRegistry.active")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{active}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.mcpRegistry.tested")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tested}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.mcpRegistry.failed")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{failed}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.mcpRegistry.retired")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-muted-foreground">{retired}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.mcpRegistry.filters")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label>{t("admin.mcpRegistry.transport")}</Label>
              <Select value={transportFilter} onValueChange={setTransportFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common.all")}</SelectItem>
                  {transports.map((tr) => (
                    <SelectItem key={tr} value={tr}>
                      {tr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("admin.mcpRegistry.statusFilter")}</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common.all")}</SelectItem>
                  {MCP_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="active-only"
                checked={activeOnly}
                onCheckedChange={setActiveOnly}
              />
              <Label htmlFor="active-only" className="cursor-pointer">
                {t("admin.mcpRegistry.activeOnly")}
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* MCP servers list */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.mcpRegistry.servers", { count: total })}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-3 pr-4 font-medium">{t("admin.mcpRegistry.slug")}</th>
                  <th className="pb-3 pr-4 font-medium">{t("admin.mcpRegistry.transport")}</th>
                  <th className="pb-3 pr-4 font-medium">{t("admin.mcpRegistry.status")}</th>
                  <th className="pb-3 pr-4 font-medium">{t("admin.mcpRegistry.lastTested")}</th>
                  <th className="pb-3 pr-4 font-medium">{t("admin.mcpRegistry.failures")}</th>
                  <th className="pb-3 pr-4 font-medium">{t("admin.mcpRegistry.capabilityTags")}</th>
                  <th className="pb-3 pr-4 font-medium">{t("admin.mcpRegistry.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {(servers ?? []).map((m) => (
                  <tr key={m.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="py-3 pr-4">
                      <div className="font-mono text-xs font-semibold">{m.slug}</div>
                      <div className="text-muted-foreground text-xs">{m.display_name}</div>
                      {m.exposes_llm ? (
                        <Badge variant="secondary" className="text-xs mt-1">
                          {t("admin.mcpRegistry.exposesLlm")}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4 text-xs font-mono">{m.transport}</td>
                    <td className="py-3 pr-4">
                      <Badge variant={statusBadgeVariant(m.status)} className="gap-1">
                        {m.status}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4 text-xs text-muted-foreground">
                      {timeAgo(m.last_tested_at, t)}
                    </td>
                    <td className="py-3 pr-4">
                      {m.test_failure_count > 0 ? (
                        <Badge variant="destructive" className="gap-1 text-xs">
                          <AlertTriangle className="h-3 w-3" />
                          {m.test_failure_count}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">{0}</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex gap-1 flex-wrap max-w-[200px]">
                        {(m.capability_tags ?? []).map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <Select
                        value={m.status}
                        onValueChange={(newStatus) => handleStatusChange(m, newStatus as McpStatus)}
                        disabled={updateStatus.isPending}
                      >
                        <SelectTrigger className="w-[150px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MCP_STATUSES.map((s) => (
                            <SelectItem key={s} value={s} className="text-xs">
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {total === 0 ? (
              <div className="text-center text-muted-foreground py-12">
                {t("admin.mcpRegistry.noServers")}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
