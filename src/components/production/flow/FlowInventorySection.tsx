/**
 * @fileoverview Flow Inventory section — real-time node inventory view.
 * Shows current volume, pure amount, avg concentration per node
 * with tank level gauge visualization and substance filter.
 */
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
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
  Container,
  Droplets,
  Gauge,
  Calendar,
} from "lucide-react";
import {
  useFlowNodeInventoryAdmin,
  useFlowSubstancesAdmin,
  useFlowNodesAdmin,
  type FlowNodeInventory,
} from "@/hooks";

/** Visual tank gauge for nodes with known capacity */
function TankGauge({
  currentVolume,
  capacityL,
  label,
}: {
  capacityL: number | null;
  currentVolume: number;
  label: string;
}) {
  const { t } = useTranslation();

  if (!capacityL || capacityL <= 0) {
    return (
      <span className="text-xs text-muted-foreground">
        {t("admin.production.flow.inventory.noCapacity")}
      </span>
    );
  }

  const pct = Math.min(100, Math.max(0, (currentVolume / capacityL) * 100));
  const levelClass =
    pct > 90
      ? "bg-red-500"
      : pct > 70
        ? "bg-yellow-500"
        : "bg-green-500";

  return (
    <div className="space-y-1 min-w-[120px]">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${levelClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-xs text-muted-foreground text-right">
        {currentVolume.toFixed(1)} / {capacityL.toFixed(0)} l
      </div>
    </div>
  );
}

/**
 * Inventory section — per-node substance inventory state
 * with visual tank level gauges and filterable by substance.
 */
export default function FlowInventorySection() {
  const { t } = useTranslation();

  const [selectedSubstanceId, setSelectedSubstanceId] = useState<string>("");

  const { data: substances } = useFlowSubstancesAdmin({ is_active: true });
  const { data: nodes } = useFlowNodesAdmin();

  const { data: inventory, isLoading } = useFlowNodeInventoryAdmin({
    substance_id: selectedSubstanceId || undefined,
  });

  // Build capacity map from nodes
  const capacityMap = useMemo(() => {
    const m = new Map<string, number | null>();
    nodes?.forEach((n) => m.set(n.id, n.capacity_l));
    return m;
  }, [nodes]);

  // Stats
  const stats = useMemo(() => {
    if (!inventory || inventory.length === 0) {
      return { totalVolume: 0, totalPure: 0, activeNodes: 0 };
    }
    return {
      totalVolume: inventory.reduce(
        (sum, inv) => sum + inv.current_volume_l,
        0,
      ),
      totalPure: inventory.reduce((sum, inv) => sum + inv.current_pure_l, 0),
      activeNodes: inventory.filter((inv) => inv.current_volume_l > 0).length,
    };
  }, [inventory]);

  const columns: ColumnDef<FlowNodeInventory>[] = useMemo(
    () => [
      {
        accessorKey: "node_code",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("admin.production.flow.inventory.nodeCode")}
          />
        ),
        cell: ({ row }) => (
          <span className="font-mono">{row.original.node_code}</span>
        ),
      },
      {
        accessorKey: "node_name",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("admin.production.flow.inventory.nodeName")}
          />
        ),
      },
      {
        accessorKey: "node_type",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("admin.production.flow.inventory.nodeType")}
          />
        ),
        cell: ({ row }) => (
          <Badge variant="outline">
            {t(
              `admin.production.flow.nodeType.${row.original.node_type}`,
            )}
          </Badge>
        ),
      },
      {
        accessorKey: "current_volume_l",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("admin.production.flow.inventory.currentVolume")}
          />
        ),
        cell: ({ row }) => `${row.original.current_volume_l.toFixed(2)} l`,
      },
      {
        accessorKey: "current_pure_l",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("admin.production.flow.inventory.currentPure")}
          />
        ),
        cell: ({ row }) => `${row.original.current_pure_l.toFixed(4)} l`,
      },
      {
        accessorKey: "avg_concentration_pct",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("admin.production.flow.inventory.avgConcentration")}
          />
        ),
        cell: ({ row }) =>
          `${row.original.avg_concentration_pct.toFixed(1)}%`,
      },
      {
        id: "tank_level",
        header: t("admin.production.flow.inventory.tankLevel"),
        cell: ({ row }) => (
          <TankGauge
            currentVolume={row.original.current_volume_l}
            capacityL={capacityMap.get(row.original.node_id) ?? null}
            label={t("admin.production.flow.inventory.fillLevel")}
          />
        ),
      },
      {
        accessorKey: "last_flow_date",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("admin.production.flow.inventory.lastFlowDate")}
          />
        ),
        cell: ({ row }) =>
          row.original.last_flow_date
            ? new Date(row.original.last_flow_date).toLocaleString()
            : "—",
      },
      {
        accessorKey: "total_records",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("admin.production.flow.inventory.totalRecords")}
          />
        ),
      },
    ],
    [t, capacityMap],
  );

  return (
    <div className="space-y-6">
      {/* Substance filter */}
      <Card>
        <CardContent className="pt-6">
          <div className="max-w-md space-y-2">
            <Label>
              {t("admin.production.flow.inventory.filterSubstance")}
            </Label>
            <Select
              value={selectedSubstanceId}
              onValueChange={setSelectedSubstanceId}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={t(
                    "admin.production.flow.inventory.selectSubstance",
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {substances?.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.substance_code} — {s.substance_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      {selectedSubstanceId && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-500/10">
                    <Droplets className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t("admin.production.flow.inventory.totalVolume")}
                    </p>
                    <p className="text-2xl font-semibold">
                      {stats.totalVolume.toFixed(2)} l
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-500/10">
                    <Gauge className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t("admin.production.flow.inventory.totalPure")}
                    </p>
                    <p className="text-2xl font-semibold">
                      {stats.totalPure.toFixed(4)} l
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Container className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t("admin.production.flow.inventory.activeNodes")}
                    </p>
                    <p className="text-2xl font-semibold">
                      {stats.activeNodes}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tank level visualization cards */}
          {inventory && inventory.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Container className="w-5 h-5" />
                  {t("admin.production.flow.inventory.tankLevelsTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {inventory.map((inv) => {
                    const capacity =
                      capacityMap.get(inv.node_id) ?? null;
                    return (
                      <Card key={inv.node_id} className="p-3">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-sm font-medium">
                              {inv.node_code}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {t(
                                `admin.production.flow.nodeType.${inv.node_type}`,
                              )}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {inv.node_name}
                          </p>
                          <TankGauge
                            currentVolume={inv.current_volume_l}
                            capacityL={capacity}
                            label={t(
                              "admin.production.flow.inventory.fillLevel",
                            )}
                          />
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Calendar className="w-3 h-3" />
                            {inv.last_flow_date
                              ? new Date(
                                  inv.last_flow_date,
                                ).toLocaleDateString()
                              : "—"}
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Inventory table */}
          {isLoading ? (
            <p className="text-muted-foreground">{t("common.loading")}</p>
          ) : (
            <DataTable
              columns={columns}
              data={inventory ?? []}
              searchKey="node_name"
            />
          )}
        </>
      )}

      {!selectedSubstanceId && (
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground">
              {t("admin.production.flow.inventory.selectSubstanceHint")}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
