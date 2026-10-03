/**
 * Flow Records Section — orchestrator component.
 * Delegates dialogs and balance display to sub-components.
 * @module FlowRecordsSection
 */

import { useRef, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import type { UseMutationResult } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Activity,
  AlertTriangle,
  ArrowRight,
  Copy,
  Download,
  Droplets,
  FilePen,
  FileX,
  Printer,
  RotateCcw,
  TrendingUp,
} from "lucide-react";

import FlowSankeyDiagram from "../FlowSankeyDiagram";
import {
  useFlowRecordsAdmin,
  useFlowNodesAdmin,
  useFlowSubstancesAdmin,
  useFlowBalanceAdmin,
  useCreateFlowRecordMutation,
  useDuplicateBatchFlowMutation,
} from "@/hooks/useAdminProductionFlow";
import { useProductionBatchesAdmin } from "@/hooks/useAdminProduction";
import { useCreateFlowCorrectionMutation } from "@/hooks/useAdminProductionEnhancements";
import type { FlowNode, FlowRecord, FlowSubstance } from "@/hooks/useAdminProductionFlow";

import FlowRecordFormDialog from "./FlowRecordFormDialog";
import FlowCorrectionDialog from "./FlowCorrectionDialog";
import type { FlowCorrectionDialogHandle } from "./FlowCorrectionDialog";
import FlowBatchDuplicationDialog from "./FlowBatchDuplicationDialog";
import FlowBalanceSection from "./FlowBalanceSection";
import { downloadCsvFile } from "./flowRecordsUtils";

export default function FlowRecordsSection() {
  const { t } = useTranslation();

  // Filters
  const [filterBatchId, setFilterBatchId] = useState<string>("");
  const [filterSubstanceId, setFilterSubstanceId] = useState<string>("");

  // Master data for lookups
  const { data: nodes } = useFlowNodesAdmin({ is_active: true });
  const { data: substances } = useFlowSubstancesAdmin({ is_active: true });
  const { data: batches } = useProductionBatchesAdmin();

  // Records query
  const { data: records } = useFlowRecordsAdmin({
    batch_id: filterBatchId || undefined,
    substance_id: filterSubstanceId || undefined,
  });

  // Balance query — requires both batch and substance
  const { data: balance, isLoading: balanceLoading } = useFlowBalanceAdmin({
    batch_id: filterBatchId || undefined,
    substance_id: filterSubstanceId || undefined,
  });

  // Mutations
  const createMutation = useCreateFlowRecordMutation();
  const dupMutation = useDuplicateBatchFlowMutation();
  const correctionMutation = useCreateFlowCorrectionMutation();

  // Dialogs
  const [isDupOpen, setIsDupOpen] = useState(false);
  const correctionRef = useRef<FlowCorrectionDialogHandle>(null);

  // Cycle detection
  const [cycleWarnings, setCycleWarnings] = useState<string[][]>([]);
  const [showCycles, setShowCycles] = useState(false);

  // Lookup maps
  const nodeMap = useMemo(() => {
    const m = new Map<string, FlowNode>();
    nodes?.forEach((n) => m.set(n.id, n));
    return m;
  }, [nodes]);

  const substanceMap = useMemo(() => {
    const m = new Map<string, FlowSubstance>();
    substances?.forEach((s) => m.set(s.id, s));
    return m;
  }, [substances]);

  const formatNodeLabel = (nodeId: string | null) => {
    if (!nodeId) return "—";
    const node = nodeMap.get(nodeId);
    return node ? `${node.node_code} (${node.node_name})` : nodeId.slice(0, 8);
  };

  // ==================== CSV Export ====================
  const exportRecordsCsv = () => {
    if (!records || records.length === 0) return;
    const headers = [
      "Date", "Substance", "Source Node", "Target Node",
      "Volume (l)", "Concentration %", "Pure Amount (l)",
      "Temperature (C)", "Notes",
    ];
    const rows = records.map((r) => {
      const s = r.substance_id ? substanceMap.get(r.substance_id) : null;
      return [
        new Date(r.flow_date).toISOString(),
        s?.substance_name ?? "",
        formatNodeLabel(r.source_node_id),
        formatNodeLabel(r.target_node_id),
        r.volume_l,
        r.concentration_pct,
        r.pure_amount_l,
        r.temperature_c ?? "",
        (r.notes ?? "").replace(/,/g, ";"),
      ].join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    downloadCsvFile(csv, "flow-records");
  };

  const exportBalanceCsv = () => {
    if (!balance || balance.length === 0) return;
    const headers = [
      "Node Code", "Node Name", "Type", "Received (l)",
      "Dispatched (l)", "Balance (l)", "Pure Balance (l)",
      "Avg Conc %", "Records",
    ];
    const rows = balance.map((b) =>
      [
        b.node_code, b.node_name, b.node_type,
        b.total_received_volume_l, b.total_dispatched_volume_l,
        b.balance_volume_l, b.balance_pure_l,
        b.avg_concentration_pct, b.record_count,
      ].join(","),
    );
    const csv = [headers.join(","), ...rows].join("\n");
    downloadCsvFile(csv, "flow-balance");
  };

  // ==================== Cycle Detection ====================
  const detectCycles = () => {
    if (!records || records.length === 0 || !nodes) {
      setCycleWarnings([]);
      setShowCycles(true);
      return;
    }
    const adjacency = new Map<string, Set<string>>();
    for (const r of records) {
      if (!r.source_node_id || !r.target_node_id) continue;
      if (!adjacency.has(r.source_node_id)) {
        adjacency.set(r.source_node_id, new Set());
      }
      adjacency.get(r.source_node_id)?.add(r.target_node_id);
    }
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const cycles: string[][] = [];

    const dfs = (nodeId: string, path: string[]): void => {
      visited.add(nodeId);
      recStack.add(nodeId);
      const neighbors = adjacency.get(nodeId);
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            dfs(neighbor, [...path, neighbor]);
          } else if (recStack.has(neighbor)) {
            const cycleStart = path.indexOf(neighbor);
            const cycle =
              cycleStart >= 0
                ? path.slice(cycleStart).concat(neighbor)
                : [...path, neighbor];
            cycles.push(
              cycle.map(
                (id) => nodeMap.get(id)?.node_code ?? id.slice(0, 8),
              ),
            );
          }
        }
      }
      recStack.delete(nodeId);
    };

    for (const nodeId of adjacency.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId, [nodeId]);
      }
    }
    setCycleWarnings(cycles);
    setShowCycles(true);
  };

  // ==================== Columns ====================
  const columns: ColumnDef<FlowRecord>[] = [
    {
      accessorKey: "flow_date",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("admin.production.flow.records.flowDate")} />
      ),
      cell: ({ row }) => new Date(row.original.flow_date).toLocaleString(),
    },
    {
      accessorKey: "substance_id",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("admin.production.flow.records.substance")} />
      ),
      cell: ({ row }) => {
        const s = row.original.substance_id ? substanceMap.get(row.original.substance_id) : null;
        return s ? s.substance_name : "—";
      },
    },
    {
      id: "flow_direction",
      header: t("admin.production.flow.records.direction"),
      cell: ({ row }) => (
        <div className="flex items-center gap-1 text-sm">
          <span className="font-mono">{formatNodeLabel(row.original.source_node_id)}</span>
          <ArrowRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
          <span className="font-mono">{formatNodeLabel(row.original.target_node_id)}</span>
        </div>
      ),
    },
    {
      accessorKey: "volume_l",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("admin.production.flow.records.volume")} />
      ),
      cell: ({ row }) => `${row.original.volume_l} l`,
    },
    {
      accessorKey: "concentration_pct",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("admin.production.flow.records.concentration")} />
      ),
      cell: ({ row }) => `${row.original.concentration_pct}%`,
    },
    {
      accessorKey: "pure_amount_l",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("admin.production.flow.records.pureAmount")} />
      ),
      cell: ({ row }) => `${row.original.pure_amount_l.toFixed(4)} l`,
    },
    {
      accessorKey: "temperature_c",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("admin.production.flow.records.temperature")} />
      ),
      cell: ({ row }) =>
        row.original.temperature_c != null ? `${row.original.temperature_c} °C` : "—",
    },
    {
      id: "record_status",
      header: t("common.status"),
      cell: ({ row }) => {
        const record = row.original;
        const isCorrection = "is_correction" in record && record.is_correction;
        const recordIsStorno = "is_storno" in record && record.is_storno;
        return (
          <div className="flex items-center gap-1">
            {isCorrection && (
              <Badge variant="outline" className="text-amber-600 border-amber-300">
                <FilePen className="w-3 h-3 mr-1" />
                {t("admin.production.flow.corrections.isCorrection")}
              </Badge>
            )}
            {recordIsStorno && (
              <Badge variant="destructive">
                <FileX className="w-3 h-3 mr-1" />
                {t("admin.production.flow.corrections.isStorno")}
              </Badge>
            )}
            {!isCorrection && !recordIsStorno && "—"}
          </div>
        );
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const record = row.original;
        const isCorrection = "is_correction" in record && record.is_correction;
        const recordIsStorno = "is_storno" in record && record.is_storno;
        if (isCorrection || recordIsStorno) return null;
        return (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => correctionRef.current?.open(record.id, false)}
              title={t("admin.production.flow.corrections.createCorrection")}
            >
              <FilePen className="w-3 h-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => correctionRef.current?.open(record.id, true)}
              title={t("admin.production.flow.corrections.createStorno")}
            >
              <FileX className="w-3 h-3" />
            </Button>
          </div>
        );
      },
    },
  ];

  const stats = {
    total: records?.length ?? 0,
    totalVolume: records?.reduce((sum, r) => sum + r.volume_l, 0).toFixed(2) ?? "0",
    totalPure: records?.reduce((sum, r) => sum + r.pure_amount_l, 0).toFixed(4) ?? "0",
  };

  const showBalance = !!filterBatchId && !!filterSubstanceId;

  return (
    <div className="space-y-6 print:space-y-4">
      {/* Print header — only visible in print */}
      <div className="hidden print:block">
        <h1 className="text-2xl font-bold">{t("admin.production.flow.print.subtitle")}</h1>
        <p className="text-sm text-muted-foreground">{new Date().toLocaleString()}</p>
      </div>

      {/* Filters */}
      <Card className="print:hidden">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t("admin.production.flow.records.filterBatch")}</Label>
              <Select value={filterBatchId} onValueChange={setFilterBatchId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("admin.production.flow.records.allBatches")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">
                    {t("admin.production.flow.records.allBatches")}
                  </SelectItem>
                  {batches?.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.batch_code} — {b.product?.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("admin.production.flow.records.filterSubstance")}</Label>
              <Select value={filterSubstanceId} onValueChange={setFilterSubstanceId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("admin.production.flow.records.allSubstances")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">
                    {t("admin.production.flow.records.allSubstances")}
                  </SelectItem>
                  {substances?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.substance_code} — {s.substance_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Action bar */}
      <div className="flex flex-wrap gap-2 print:hidden">
        <Button variant="outline" size="sm" onClick={exportRecordsCsv} disabled={!records || records.length === 0}>
          <Download className="w-4 h-4 mr-2" />
          {t("admin.production.flow.csv.exportRecords")}
        </Button>
        {showBalance && (
          <Button variant="outline" size="sm" onClick={exportBalanceCsv} disabled={!balance || balance.length === 0}>
            <Download className="w-4 h-4 mr-2" />
            {t("admin.production.flow.csv.exportBalance")}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={detectCycles}>
          <RotateCcw className="w-4 h-4 mr-2" />
          {t("admin.production.flow.cycleDetection.run")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="w-4 h-4 mr-2" />
          {t("admin.production.flow.print.printButton")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setIsDupOpen(true)}>
          <Copy className="w-4 h-4 mr-2" />
          {t("admin.production.flow.batchDuplication.title")}
        </Button>
      </div>

      {/* Batch duplication dialog */}
      <FlowBatchDuplicationDialog
        batches={batches}
        dupMutation={dupMutation as unknown as UseMutationResult<unknown, Error, Record<string, unknown>>}
        isOpen={isDupOpen}
        onOpenChange={setIsDupOpen}
      />

      {/* Cycle detection results */}
      {showCycles && (
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <RotateCcw className="w-4 h-4" />
              {t("admin.production.flow.cycleDetection.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {cycleWarnings.length === 0 ? (
              <p className="text-sm text-green-600">
                {t("admin.production.flow.cycleDetection.noCycles")}
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-amber-600 flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" />
                  {t("admin.production.flow.cycleDetection.cyclesFound", { count: cycleWarnings.length })}
                </p>
                <ul className="list-disc list-inside text-sm space-y-1">
                  {cycleWarnings.map((cycle, idx) => (
                    <li key={idx} className="font-mono text-xs">
                      {cycle.join(" → ")}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Activity className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.production.flow.records.totalRecords")}</p>
                <p className="text-2xl font-semibold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Droplets className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.production.flow.records.totalVolume")}</p>
                <p className="text-2xl font-semibold">{stats.totalVolume} l</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <TrendingUp className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.production.flow.records.totalPure")}</p>
                <p className="text-2xl font-semibold">{stats.totalPure} l</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Balance section — only visible when both batch + substance selected */}
      {showBalance && (
        <FlowBalanceSection balance={balance} balanceLoading={balanceLoading} />
      )}

      {/* Sankey diagram — show when records exist */}
      {records && records.length > 0 && nodes && nodes.length > 0 && (
        <FlowSankeyDiagram nodes={nodes} records={records} />
      )}

      {/* Create record button + dialog */}
      <FlowRecordFormDialog
        batches={batches}
        createMutation={createMutation as unknown as UseMutationResult<unknown, Error, Record<string, unknown>>}
        nodes={nodes}
        substances={substances}
      />

      {/* Records table */}
      <DataTable columns={columns} data={records ?? []} searchKey="notes" />

      {/* Correction/Storno dialog */}
      <FlowCorrectionDialog ref={correctionRef} correctionMutation={correctionMutation as unknown as UseMutationResult<unknown, Error, Record<string, unknown>>} />
    </div>
  );
}
