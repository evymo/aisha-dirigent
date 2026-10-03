/**
 * @fileoverview Real-time-ish monitoring dashboard for flow-node sensors.
 *
 * Shows a card grid with latest values, min/max/avg aggregation,
 * excursion indicators, and a configurable refresh interval.
 * Data comes from `useFlowNodeMonitoring` hook.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Clock,
  ThermometerSun,
} from "lucide-react";
import {
  useFlowNodeMonitoring,
  useFlowNodesAdmin,
  type FlowNodeSensorSummary,
} from "@/hooks";

const HOURS_OPTIONS = [1, 4, 8, 12, 24, 48, 72] as const;

const READING_ICONS: Record<string, React.ReactNode> = {
  conductivity: <Activity className="w-4 h-4" />,
  custom: <BarChart3 className="w-4 h-4" />,
  dissolved_oxygen: <Activity className="w-4 h-4" />,
  duration: <Clock className="w-4 h-4" />,
  flow_rate: <Activity className="w-4 h-4" />,
  humidity: <ThermometerSun className="w-4 h-4" />,
  ph: <Activity className="w-4 h-4" />,
  power: <Activity className="w-4 h-4" />,
  pressure: <Activity className="w-4 h-4" />,
  temperature: <ThermometerSun className="w-4 h-4" />,
  weight: <BarChart3 className="w-4 h-4" />,
};

function formatRecency(isoStr: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  const diffMs = Date.now() - new Date(isoStr).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return t("admin.production.flow.monitoring.recency.lessThanMinute");
  if (diffMin < 60) return t("admin.production.flow.monitoring.recency.minutes", { count: diffMin });
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return t("admin.production.flow.monitoring.recency.hours", { count: diffH });
  return t("admin.production.flow.monitoring.recency.days", { count: Math.floor(diffH / 24) });
}

function SummaryCard({ row }: { row: FlowNodeSensorSummary }) {
  const { t } = useTranslation();
  const icon = READING_ICONS[row.reading_type] ?? (
    <Activity className="w-4 h-4" />
  );

  return (
    <Card className={row.has_excursion ? "border-destructive/50" : ""}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            {icon}
            <span className="truncate">{row.node_name}</span>
          </CardTitle>
          {row.has_excursion && (
            <Badge variant="destructive" className="flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {t("admin.production.flow.monitoring.excursion")}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {row.node_code}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {t(
              `admin.production.flow.iotConfig.readingTypes.${row.reading_type}`,
            )}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Latest value — prominent */}
        <div className="text-center py-2">
          <span className="text-3xl font-bold tabular-nums">
            {row.latest_value.toFixed(2)}
          </span>
          <span className="text-sm text-muted-foreground ml-1">
            {row.latest_unit}
          </span>
        </div>

        {/* Statistics grid */}
        <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <ArrowDown className="w-3 h-3 text-blue-500" />
            <span>
              {t("admin.production.flow.monitoring.min")}: {row.min_value.toFixed(2)}
            </span>
          </div>
          <div className="text-center">
            {t("admin.production.flow.monitoring.avg")}: {row.avg_value.toFixed(2)}
          </div>
          <div className="flex items-center justify-end gap-1">
            <ArrowUp className="w-3 h-3 text-orange-500" />
            <span>
              {t("admin.production.flow.monitoring.max")}: {row.max_value.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t">
          <span>
            {row.reading_count}{" "}
            {t("admin.production.flow.monitoring.readings")}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatRecency(row.latest_recorded_at, t)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Monitoring dashboard showing sensor summary cards per flow node.
 */
export default function FlowNodeMonitoringDashboard() {
  const { t } = useTranslation();
  const [hoursBack, setHoursBack] = useState(24);
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();

  const { data: nodes } = useFlowNodesAdmin({ is_active: true });
  const { data: summary, isLoading } = useFlowNodeMonitoring({
    flow_node_id: selectedNodeId,
    hours_back: hoursBack,
  });

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-end">
        <div className="space-y-2 w-48">
          <Label className="text-xs">
            {t("admin.production.flow.monitoring.hoursBack")}
          </Label>
          <Select
            value={String(hoursBack)}
            onValueChange={(v) => setHoursBack(Number(v))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOURS_OPTIONS.map((h) => (
                <SelectItem key={h} value={String(h)}>
                  {h} h
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2 w-56">
          <Label className="text-xs">
            {t("admin.production.flow.monitoring.filterNode")}
          </Label>
          <Select
            value={selectedNodeId ?? "__all__"}
            onValueChange={(v) =>
              setSelectedNodeId(v === "__all__" ? undefined : v)
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">
                {t("admin.production.flow.monitoring.allNodes")}
              </SelectItem>
              {nodes?.map((n) => (
                <SelectItem key={n.id} value={n.id}>
                  {n.node_code} — {n.node_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Dashboard grid */}
      {isLoading && (
        <p className="text-sm text-muted-foreground text-center py-8">
          {t("common.loading")}
        </p>
      )}

      {!isLoading && (!summary || summary.length === 0) && (
        <p className="text-sm text-muted-foreground text-center py-8">
          {t("admin.production.flow.monitoring.noData")}
        </p>
      )}

      {!isLoading && summary && summary.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {summary.map((row) => (
            <SummaryCard
              key={`${row.flow_node_id}-${row.reading_type}`}
              row={row}
            />
          ))}
        </div>
      )}
    </div>
  );
}
