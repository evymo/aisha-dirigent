/**
 * Balance table + Angels' Share (loss computation) display.
 * @module FlowBalanceSection
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Calculator } from "lucide-react";

import type { FlowBalance } from "@/hooks/useAdminProductionFlow";

interface FlowBalanceSectionProps {
  balance: FlowBalance[] | undefined;
  balanceLoading: boolean;
}

export default function FlowBalanceSection({
  balance,
  balanceLoading,
}: FlowBalanceSectionProps) {
  const { t } = useTranslation();

  // ==================== Angels' Share (Loss Computation) ====================
  const angelsShare = useMemo(() => {
    if (!balance || balance.length === 0) return null;
    const supplierNodes = balance.filter((b) => b.node_type === "supplier");
    const wasteNodes = balance.filter((b) => b.node_type === "waste");
    const totalInput = supplierNodes.reduce(
      (sum, b) => sum + b.total_dispatched_volume_l,
      0,
    );
    const totalInputPure = supplierNodes.reduce(
      (sum, b) => sum + b.total_dispatched_pure_l,
      0,
    );
    const totalAccounted = balance.reduce(
      (sum, b) => sum + Math.max(0, b.balance_volume_l),
      0,
    );
    const totalWaste = wasteNodes.reduce(
      (sum, b) => sum + b.total_received_volume_l,
      0,
    );
    const totalOutput = totalAccounted + totalWaste;
    const loss = totalInput - totalOutput;
    const lossPure = totalInputPure - balance.reduce(
      (sum, b) => sum + Math.max(0, b.balance_pure_l),
      0,
    );
    const lossPct = totalInput > 0 ? (loss / totalInput) * 100 : 0;
    return { totalInput, totalInputPure, totalOutput, totalWaste, loss, lossPure, lossPct };
  }, [balance]);

  return (
    <>
      {/* Balance table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="w-5 h-5" />
            {t("admin.production.flow.balance.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {balanceLoading ? (
            <p className="text-muted-foreground">
              {t("common.loading")}
            </p>
          ) : balance && balance.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {t("admin.production.flow.balance.node")}
                  </TableHead>
                  <TableHead>
                    {t("admin.production.flow.balance.nodeType")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("admin.production.flow.balance.received")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("admin.production.flow.balance.dispatched")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("admin.production.flow.balance.balanceVolume")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("admin.production.flow.balance.balancePure")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("admin.production.flow.balance.avgConcentration")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("admin.production.flow.balance.recordCount")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balance.map((b: FlowBalance) => (
                  <TableRow key={b.node_id}>
                    <TableCell className="font-mono">
                      {b.node_code} ({b.node_name})
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {t(
                          `admin.production.flow.nodeType.${b.node_type}`,
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {b.total_received_volume_l.toFixed(2)} l
                    </TableCell>
                    <TableCell className="text-right">
                      {b.total_dispatched_volume_l.toFixed(2)} l
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {b.balance_volume_l.toFixed(2)} l
                    </TableCell>
                    <TableCell className="text-right">
                      {b.balance_pure_l.toFixed(4)} l
                    </TableCell>
                    <TableCell className="text-right">
                      {b.avg_concentration_pct.toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-right">
                      {b.record_count}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground">
              {t("admin.production.flow.balance.noData")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Angels' Share — loss computation */}
      {angelsShare && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              {t("admin.production.flow.angelsShare.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">
                  {t("admin.production.flow.angelsShare.totalInput")}
                </p>
                <p className="text-lg font-semibold">
                  {angelsShare.totalInput.toFixed(2)} l
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  {t("admin.production.flow.angelsShare.totalOutput")}
                </p>
                <p className="text-lg font-semibold">
                  {angelsShare.totalOutput.toFixed(2)} l
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  {t("admin.production.flow.angelsShare.totalLoss")}
                </p>
                <p className={`text-lg font-semibold ${angelsShare.loss > 0 ? "text-red-600" : "text-green-600"}`}>
                  {angelsShare.loss.toFixed(2)} l
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  {t("admin.production.flow.angelsShare.lossPct")}
                </p>
                <p className={`text-lg font-semibold ${angelsShare.lossPct > 5 ? "text-red-600" : angelsShare.lossPct > 2 ? "text-amber-600" : "text-green-600"}`}>
                  {angelsShare.lossPct.toFixed(2)}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
