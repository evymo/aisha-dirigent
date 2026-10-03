/**
 * @fileoverview Cross-Batch Traceability Panel — recursive material provenance
 * tracing across production batches. Displays a tree-like table with depth
 * indentation showing material flow between batches.
 *
 * All data access via RPC hooks, no direct DB queries.
 */
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { GitBranch, ChevronRight, Package } from "lucide-react";
import {
  useCrossBatchTraceabilityAdmin,
  useProductionBatchesAdmin,
} from "@/hooks";
import type { CrossBatchTraceabilityItem } from "@/lib/schemas/adminSchemas";

/**
 * Level indicator for tree visualization — indentation + connector arrow.
 */
function LevelIndicator({ level }: { level: number }) {
  if (level === 0) {
    return (
      <Badge variant="default" className="text-xs">
        <Package className="w-3 h-3 mr-1" />
        Root
      </Badge>
    );
  }
  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      {Array.from({ length: level }).map((_, i) => (
        <span key={i} className="w-4 border-l border-muted-foreground/30 h-4" />
      ))}
      <ChevronRight className="w-3 h-3" />
      <Badge variant="outline" className="text-xs">
        L{level}
      </Badge>
    </span>
  );
}

/**
 * Cross-Batch Traceability Panel — batch selector with recursive depth control
 * and tree-table visualization of material provenance chain.
 */
export default function CrossBatchTraceabilityPanel() {
  const { t } = useTranslation();

  // Filters
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [maxDepth, setMaxDepth] = useState(5);

  // Data hooks
  const { data: batches } = useProductionBatchesAdmin();
  const { data: traceData, isLoading } = useCrossBatchTraceabilityAdmin(
    selectedBatchId || undefined,
    maxDepth,
  );

  // Stats
  const stats = useMemo(() => {
    if (!traceData || traceData.length === 0) {
      return { totalBatches: 0, totalMaterials: 0, maxLevel: 0, totalVolume: 0 };
    }
    const uniqueBatches = new Set(traceData.map((t) => t.batch_id));
    const uniqueMaterials = new Set(
      traceData.filter((t) => t.material_id).map((t) => t.material_id),
    );
    const maxLevel = Math.max(...traceData.map((t) => t.trace_level));
    const totalVolume = traceData.reduce((sum, t) => sum + t.total_volume_l, 0);
    return {
      totalBatches: uniqueBatches.size,
      totalMaterials: uniqueMaterials.size,
      maxLevel,
      totalVolume,
    };
  }, [traceData]);

  return (
    <div className="space-y-6">
      {/* Header + Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-cyan-600" />
            {t("admin.production.flow.traceability.title")}
          </CardTitle>
          <CardDescription>
            {t("admin.production.flow.traceability.subtitle")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>{t("admin.production.flow.traceability.selectBatch")}</Label>
              <Select value={selectedBatchId} onValueChange={setSelectedBatchId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("admin.production.flow.traceability.selectBatch")} />
                </SelectTrigger>
                <SelectContent>
                  {batches?.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.batch_code} — {b.product?.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("admin.production.flow.traceability.maxDepth")}</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={maxDepth}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v >= 1 && v <= 10) setMaxDepth(v);
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      {traceData && traceData.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-2xl font-semibold">{stats.totalBatches}</p>
              <p className="text-sm text-muted-foreground">
                {t("admin.production.flow.traceability.batchCode")}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-2xl font-semibold">{stats.totalMaterials}</p>
              <p className="text-sm text-muted-foreground">
                {t("admin.production.flow.traceability.materialName")}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-2xl font-semibold">{stats.maxLevel}</p>
              <p className="text-sm text-muted-foreground">
                {t("admin.production.flow.traceability.maxDepth")}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-2xl font-semibold">{stats.totalVolume.toFixed(1)} l</p>
              <p className="text-sm text-muted-foreground">
                {t("admin.production.flow.traceability.totalVolume")}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Traceability Tree Table */}
      {!selectedBatchId ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {t("admin.production.flow.traceability.selectBatch")}
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {t("common.loading")}
          </CardContent>
        </Card>
      ) : traceData && traceData.length > 0 ? (
        <Card>
          <CardContent className="pt-6 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">
                    {t("admin.production.flow.traceability.traceLevel")}
                  </TableHead>
                  <TableHead>
                    {t("admin.production.flow.traceability.batchCode")}
                  </TableHead>
                  <TableHead>
                    {t("admin.production.flow.traceability.materialCode")}
                  </TableHead>
                  <TableHead>
                    {t("admin.production.flow.traceability.materialName")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("admin.production.flow.traceability.totalVolume")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("admin.production.flow.traceability.totalPure")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("admin.production.flow.traceability.recordCount")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {traceData.map((row: CrossBatchTraceabilityItem, idx: number) => (
                  <TableRow
                    key={`${row.batch_id}-${row.material_id ?? "root"}-${idx}`}
                    className={row.trace_level === 0 ? "bg-muted/50 font-medium" : ""}
                  >
                    <TableCell>
                      <LevelIndicator level={row.trace_level} />
                    </TableCell>
                    <TableCell>
                      <span className="font-mono">{row.batch_code}</span>
                    </TableCell>
                    <TableCell>
                      {row.material_code ? (
                        <span className="font-mono text-sm">{row.material_code}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.material_name ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.total_volume_l.toFixed(2)} l
                    </TableCell>
                    <TableCell className="text-right">
                      {row.total_pure_l.toFixed(3)} l
                    </TableCell>
                    <TableCell className="text-right">
                      {row.record_count}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {t("admin.production.flow.traceability.noData")}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
