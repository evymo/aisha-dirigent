/**
 * @fileoverview Angels' Share Report Section — production loss analysis for
 * customs authority reporting. Computes per-batch, per-substance losses
 * including pure alcohol calculations.
 *
 * All data access via RPC hooks, no direct DB queries.
 */
import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  Droplets,
  Download,
  TrendingDown,
  Beaker,
  BarChart3,
} from "lucide-react";
import {
  useAngelsShareReportAdmin,
  useProductionBatchesAdmin,
  useFlowSubstancesAdmin,
} from "@/hooks";
import type { AngelsShareReportItem } from "@/lib/schemas/adminSchemas";

/**
 * Angels' Share Report — date-filtered loss analysis with CSV export.
 */
export default function AngelsShareReportSection() {
  const { t } = useTranslation();

  // Filters
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterBatchId, setFilterBatchId] = useState("");
  const [filterSubstanceId, setFilterSubstanceId] = useState("");

  // Data hooks
  const { data: batches } = useProductionBatchesAdmin();
  const { data: substances } = useFlowSubstancesAdmin();

  const hasDateRange = !!dateFrom && !!dateTo;
  const { data: report, isLoading } = useAngelsShareReportAdmin({
    batch_id: filterBatchId || undefined,
    date_from: dateFrom,
    date_to: dateTo,
    substance_id: filterSubstanceId || undefined,
  });

  // Totals
  const totals = useMemo(() => {
    if (!report || report.length === 0) {
      return {
        totalInput: 0,
        totalOutput: 0,
        totalLoss: 0,
        totalPureAlcoholLoss: 0,
        avgLossPct: 0,
      };
    }
    const totalInput = report.reduce((sum, r) => sum + r.total_input_volume_l, 0);
    const totalOutput = report.reduce((sum, r) => sum + r.total_output_volume_l, 0);
    const totalLoss = report.reduce((sum, r) => sum + r.total_loss_volume_l, 0);
    const totalPureAlcoholLoss = report.reduce((sum, r) => sum + r.pure_alcohol_loss_l, 0);
    const avgLossPct = totalInput > 0 ? (totalLoss / totalInput) * 100 : 0;
    return { totalInput, totalOutput, totalLoss, totalPureAlcoholLoss, avgLossPct };
  }, [report]);

  // CSV export
  const handleExportCsv = useCallback(() => {
    if (!report || report.length === 0) return;
    const headers = [
      "batch_code",
      "substance_code",
      "substance_name",
      "total_input_volume_l",
      "total_output_volume_l",
      "total_loss_volume_l",
      "loss_pct",
      "avg_input_concentration_pct",
      "avg_output_concentration_pct",
      "pure_alcohol_loss_l",
      "record_count",
      "first_flow_date",
      "last_flow_date",
    ];
    const rows = report.map((r) =>
      headers.map((h) => {
        const val = r[h as keyof AngelsShareReportItem];
        return val != null ? String(val) : "";
      }),
    );
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `angels_share_${dateFrom}_${dateTo}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [report, dateFrom, dateTo]);

  const columns: ColumnDef<AngelsShareReportItem>[] = [
    {
      accessorKey: "batch_code",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.traceability.batchCode")}
        />
      ),
      cell: ({ row }) => (
        <span className="font-mono font-medium">{row.original.batch_code}</span>
      ),
    },
    {
      accessorKey: "substance_name",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.angelsShare.filterSubstance")}
        />
      ),
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.substance_name}</div>
          <div className="text-xs text-muted-foreground font-mono">{row.original.substance_code}</div>
        </div>
      ),
    },
    {
      accessorKey: "total_input_volume_l",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.angelsShare.totalInput")}
        />
      ),
      cell: ({ row }) => `${row.original.total_input_volume_l.toFixed(2)} l`,
    },
    {
      accessorKey: "total_output_volume_l",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.angelsShare.totalOutput")}
        />
      ),
      cell: ({ row }) => `${row.original.total_output_volume_l.toFixed(2)} l`,
    },
    {
      accessorKey: "total_loss_volume_l",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.angelsShare.totalLoss")}
        />
      ),
      cell: ({ row }) => (
        <span className={row.original.total_loss_volume_l > 0 ? "text-red-600 font-semibold" : ""}>
          {row.original.total_loss_volume_l.toFixed(2)} l
        </span>
      ),
    },
    {
      accessorKey: "loss_pct",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.angelsShare.lossPct")}
        />
      ),
      cell: ({ row }) => {
        const pct = row.original.loss_pct;
        let color = "";
        if (pct > 5) color = "text-red-600 font-semibold";
        else if (pct > 2) color = "text-amber-600";
        return <span className={color}>{pct.toFixed(2)}%</span>;
      },
    },
    {
      accessorKey: "avg_input_concentration_pct",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.angelsShare.avgInputConcentration")}
        />
      ),
      cell: ({ row }) => `${row.original.avg_input_concentration_pct.toFixed(1)}%`,
    },
    {
      accessorKey: "avg_output_concentration_pct",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.angelsShare.avgOutputConcentration")}
        />
      ),
      cell: ({ row }) => `${row.original.avg_output_concentration_pct.toFixed(1)}%`,
    },
    {
      accessorKey: "pure_alcohol_loss_l",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.angelsShare.pureAlcoholLoss")}
        />
      ),
      cell: ({ row }) => (
        <span className="font-semibold text-red-600">
          {row.original.pure_alcohol_loss_l.toFixed(3)} l
        </span>
      ),
    },
    {
      accessorKey: "record_count",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.angelsShare.recordCount")}
        />
      ),
    },
    {
      accessorKey: "first_flow_date",
      header: t("admin.production.flow.angelsShare.firstFlowDate"),
      cell: ({ row }) =>
        row.original.first_flow_date
          ? new Date(row.original.first_flow_date).toLocaleDateString()
          : "—",
    },
    {
      accessorKey: "last_flow_date",
      header: t("admin.production.flow.angelsShare.lastFlowDate"),
      cell: ({ row }) =>
        row.original.last_flow_date
          ? new Date(row.original.last_flow_date).toLocaleDateString()
          : "—",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Droplets className="w-5 h-5 text-purple-600" />
            {t("admin.production.flow.angelsShare.title")}
          </CardTitle>
          <CardDescription>
            {t("admin.production.flow.angelsShare.subtitle")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>{t("admin.production.flow.angelsShare.dateFrom")}</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("admin.production.flow.angelsShare.dateTo")}</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("admin.production.flow.angelsShare.filterBatch")}</Label>
              <Select value={filterBatchId} onValueChange={setFilterBatchId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("admin.production.flow.records.allBatches")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("admin.production.flow.records.allBatches")}</SelectItem>
                  {batches?.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.batch_code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("admin.production.flow.angelsShare.filterSubstance")}</Label>
              <Select value={filterSubstanceId} onValueChange={setFilterSubstanceId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("common.all")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("common.all")}</SelectItem>
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

      {/* Summary Cards */}
      {report && report.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <Beaker className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("admin.production.flow.angelsShare.totalInput")}
                  </p>
                  <p className="text-xl font-semibold">{totals.totalInput.toFixed(1)} l</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <Beaker className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("admin.production.flow.angelsShare.totalOutput")}
                  </p>
                  <p className="text-xl font-semibold">{totals.totalOutput.toFixed(1)} l</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-red-500/10">
                  <TrendingDown className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("admin.production.flow.angelsShare.totalLoss")}
                  </p>
                  <p className="text-xl font-semibold text-red-600">{totals.totalLoss.toFixed(1)} l</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/10">
                  <Droplets className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("admin.production.flow.angelsShare.pureAlcoholLoss")}
                  </p>
                  <p className="text-xl font-semibold text-red-600">{totals.totalPureAlcoholLoss.toFixed(3)} l</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10">
                  <BarChart3 className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("admin.production.flow.angelsShare.lossPct")}
                  </p>
                  <p className="text-xl font-semibold">{totals.avgLossPct.toFixed(2)}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Data Table or Empty State */}
      {!hasDateRange ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {t("admin.production.flow.angelsShare.noData")}
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {t("common.loading")}
          </CardContent>
        </Card>
      ) : report && report.length > 0 ? (
        <>
          <div className="flex justify-end">
            <Button variant="outline" onClick={handleExportCsv}>
              <Download className="w-4 h-4 mr-2" />
              {t("admin.production.flow.angelsShare.exportCsv")}
            </Button>
          </div>
          <DataTable columns={columns} data={report} searchKey="batch_code" />
        </>
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {t("admin.production.flow.angelsShare.noData")}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
