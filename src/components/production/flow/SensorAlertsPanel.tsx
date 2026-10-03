/**
 * @fileoverview Sensor Alerts Panel — threshold-based production sensor alert management.
 * Displays a filterable table of sensor alerts with acknowledge functionality.
 * All data access via RPC hooks, no direct DB queries.
 */
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/ui/data-table/DataTable";
import { DataTableColumnHeader } from "@/components/ui/data-table/DataTableColumnHeader";
import {
  Bell,
  BellOff,
  CheckCircle,
  AlertTriangle,
  Info,
  ShieldAlert,
} from "lucide-react";
import {
  useSensorAlertsAdmin,
  useAcknowledgeSensorAlertMutation,
  useProductionBatchesAdmin,
  useFlowNodesAdmin,
} from "@/hooks";
import type { ProductionSensorAlertRow } from "@/lib/schemas/adminSchemas";

/**
 * Severity badge with appropriate color coding.
 */
function SeverityBadge({ severity }: { severity: string }) {
  const { t } = useTranslation();
  switch (severity) {
    case "critical":
      return (
        <Badge variant="destructive" className="flex items-center gap-1 w-fit">
          <ShieldAlert className="w-3 h-3" />
          {t("admin.production.flow.sensorAlerts.severities.critical")}
        </Badge>
      );
    case "warning":
      return (
        <Badge className="bg-amber-500 hover:bg-amber-600 flex items-center gap-1 w-fit">
          <AlertTriangle className="w-3 h-3" />
          {t("admin.production.flow.sensorAlerts.severities.warning")}
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="flex items-center gap-1 w-fit">
          <Info className="w-3 h-3" />
          {t("admin.production.flow.sensorAlerts.severities.info")}
        </Badge>
      );
  }
}

/**
 * Sensor Alerts Panel — filterable table of sensor threshold alerts
 * with batch/node filtering and acknowledge functionality.
 */
export default function SensorAlertsPanel() {
  const { t } = useTranslation();

  // Filters
  const [filterBatchId, setFilterBatchId] = useState<string>("");
  const [filterNodeId, setFilterNodeId] = useState<string>("");
  const [onlyUnacknowledged, setOnlyUnacknowledged] = useState(true);

  // Data hooks
  const { data: batches } = useProductionBatchesAdmin();
  const { data: nodes } = useFlowNodesAdmin({ is_active: true });
  const { data: alerts, isLoading } = useSensorAlertsAdmin({
    batch_id: filterBatchId || undefined,
    acknowledged: onlyUnacknowledged ? false : undefined,
  });
  const acknowledgeMutation = useAcknowledgeSensorAlertMutation();

  // Node lookup
  const nodeMap = useMemo(() => {
    const m = new Map<string, string>();
    nodes?.forEach((n) => m.set(n.id, `${n.node_code} (${n.node_name})`));
    return m;
  }, [nodes]);

  // Stats
  const stats = useMemo(() => {
    if (!alerts) return { total: 0, critical: 0, warning: 0, info: 0 };
    return {
      total: alerts.length,
      critical: alerts.filter((a) => a.severity === "critical").length,
      warning: alerts.filter((a) => a.severity === "warning").length,
      info: alerts.filter((a) => a.severity === "info").length,
    };
  }, [alerts]);

  const columns: ColumnDef<ProductionSensorAlertRow>[] = [
    {
      accessorKey: "created_at",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("common.date")} />
      ),
      cell: ({ row }) => new Date(row.original.created_at).toLocaleString(),
    },
    {
      accessorKey: "severity",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.sensorAlerts.severity")}
        />
      ),
      cell: ({ row }) => <SeverityBadge severity={row.original.severity} />,
    },
    {
      accessorKey: "alert_type",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.sensorAlerts.alertType")}
        />
      ),
    },
    {
      accessorKey: "metric_name",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.sensorAlerts.metricName")}
        />
      ),
    },
    {
      accessorKey: "threshold_value",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.sensorAlerts.thresholdValue")}
        />
      ),
      cell: ({ row }) => row.original.threshold_value.toFixed(2),
    },
    {
      accessorKey: "actual_value",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.sensorAlerts.actualValue")}
        />
      ),
      cell: ({ row }) => {
        const diff = row.original.actual_value - row.original.threshold_value;
        const isOver = diff > 0;
        return (
          <span className={isOver ? "text-red-600 font-semibold" : ""}>
            {row.original.actual_value.toFixed(2)}
            {isOver && ` (+${diff.toFixed(2)})`}
          </span>
        );
      },
    },
    {
      accessorKey: "node_id",
      header: t("admin.production.flow.balance.node"),
      cell: ({ row }) =>
        row.original.node_id ? nodeMap.get(row.original.node_id) ?? "—" : "—",
    },
    {
      accessorKey: "message",
      header: t("admin.production.flow.sensorAlerts.message"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground max-w-[200px] truncate block">
          {row.original.message ?? "—"}
        </span>
      ),
    },
    {
      id: "status",
      header: t("common.status"),
      cell: ({ row }) => {
        if (row.original.acknowledged_at) {
          return (
            <Badge variant="outline" className="flex items-center gap-1 w-fit text-green-600 border-green-300">
              <CheckCircle className="w-3 h-3" />
              {t("admin.production.flow.sensorAlerts.acknowledged")}
            </Badge>
          );
        }
        return (
          <Badge variant="outline" className="flex items-center gap-1 w-fit text-amber-600 border-amber-300">
            <Bell className="w-3 h-3" />
            {t("admin.production.flow.sensorAlerts.unacknowledged")}
          </Badge>
        );
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        if (row.original.acknowledged_at) return null;
        return (
          <Button
            size="sm"
            variant="outline"
            onClick={() => acknowledgeMutation.mutate(row.original.id)}
            disabled={acknowledgeMutation.isPending}
          >
            <BellOff className="w-3 h-3 mr-1" />
            {t("admin.production.flow.sensorAlerts.acknowledge")}
          </Button>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Bell className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.production.flow.sensorAlerts.title")}</p>
                <p className="text-2xl font-semibold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10">
                <ShieldAlert className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("admin.production.flow.sensorAlerts.severities.critical")}
                </p>
                <p className="text-2xl font-semibold">{stats.critical}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("admin.production.flow.sensorAlerts.severities.warning")}
                </p>
                <p className="text-2xl font-semibold">{stats.warning}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Info className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("admin.production.flow.sensorAlerts.severities.info")}
                </p>
                <p className="text-2xl font-semibold">{stats.info}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>{t("admin.production.flow.records.filterBatch")}</Label>
              <Select value={filterBatchId} onValueChange={setFilterBatchId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("admin.production.flow.records.allBatches")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("admin.production.flow.records.allBatches")}</SelectItem>
                  {batches?.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.batch_code} — {b.product?.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("admin.production.flow.balance.node")}</Label>
              <Select value={filterNodeId} onValueChange={setFilterNodeId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("admin.production.flow.records.selectNode")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("common.all")}</SelectItem>
                  {nodes?.map((n) => (
                    <SelectItem key={n.id} value={n.id}>
                      {n.node_code} — {n.node_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end pb-1">
              <div className="flex items-center gap-2">
                <Switch
                  id="only-unack"
                  checked={onlyUnacknowledged}
                  onCheckedChange={setOnlyUnacknowledged}
                />
                <Label htmlFor="only-unack">
                  {t("admin.production.flow.sensorAlerts.filterUnacknowledged")}
                </Label>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      {isLoading ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {t("common.loading")}
          </CardContent>
        </Card>
      ) : alerts && alerts.length > 0 ? (
        <DataTable columns={columns} data={alerts} searchKey="metric_name" />
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {t("admin.production.flow.sensorAlerts.noAlerts")}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
