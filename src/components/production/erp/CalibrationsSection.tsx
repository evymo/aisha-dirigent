import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DataTable } from "@/components/ui/data-table/DataTable";
import { DataTableColumnHeader } from "@/components/ui/data-table/DataTableColumnHeader";
import { toast } from "sonner";
import { Plus, Gauge, AlertTriangle } from "lucide-react";
import {
  useProductionEquipmentCalibrationsAdmin,
  useCreateProductionEquipmentCalibrationMutation,
  type ProductionEquipmentCalibration,
} from "@/hooks";

/**
 * Calibrations section for Production ERP.
 * Immutable regulatory records — create only.
 */
export default function CalibrationsSection() {
  const { t } = useTranslation();
  const { data: calibrations, isLoading } = useProductionEquipmentCalibrationsAdmin();
  const createMutation = useCreateProductionEquipmentCalibrationMutation();

  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({
    equipment_id: "",
    calibration_type: "",
    result: "pass",
    reference_standard: "",
    deviation_found: "",
    deviation_limit: "",
    adjustment_made: "",
    next_due_at: "",
    notes: "",
  });

  const resetForm = () => {
    setForm({
      equipment_id: "",
      calibration_type: "",
      result: "pass",
      reference_standard: "",
      deviation_found: "",
      deviation_limit: "",
      adjustment_made: "",
      next_due_at: "",
      notes: "",
    });
  };

  const handleSubmit = () => {
    if (!form.equipment_id || !form.calibration_type) {
      toast.error(t("admin.productionErp.validation.requiredFields"));
      return;
    }
    createMutation.mutate(
      {
        equipment_id: form.equipment_id,
        calibration_type: form.calibration_type,
        result: form.result || "pass",
        reference_standard: form.reference_standard || undefined,
        deviation_found: form.deviation_found ? parseFloat(form.deviation_found) : undefined,
        deviation_limit: form.deviation_limit ? parseFloat(form.deviation_limit) : undefined,
        adjustment_made: form.adjustment_made ? true : undefined,
        next_due_at: form.next_due_at || undefined,
        notes: form.notes || undefined,
      },
      {
        onSuccess: () => {
          toast.success(t("admin.productionErp.calibrations.created"));
          setIsOpen(false);
          resetForm();
        },
        onError: () => toast.error(t("admin.productionErp.errors.saveFailed")),
      },
    );
  };

  const resultBadge = (result: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      pass: "default",
      adjusted: "secondary",
      fail: "destructive",
    };
    return <Badge variant={variants[result] ?? "outline"}>{t(`admin.productionErp.calibrationResult.${result}`)}</Badge>;
  };

  const columns: ColumnDef<ProductionEquipmentCalibration>[] = [
    {
      accessorKey: "equipment_id",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.calibrations.equipmentId")} />,
      cell: ({ row }) => row.original.equipment_id.substring(0, 8) + "...",
    },
    {
      accessorKey: "calibration_type",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.calibrations.calibrationType")} />,
    },
    {
      accessorKey: "result",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.calibrations.result")} />,
      cell: ({ row }) => resultBadge(row.original.result),
    },
    {
      accessorKey: "performed_at",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.calibrations.performedAt")} />,
      cell: ({ row }) => new Date(row.original.performed_at).toLocaleString(),
    },
    {
      accessorKey: "next_due_at",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.calibrations.nextDueAt")} />,
      cell: ({ row }) => {
        if (!row.original.next_due_at) return "—";
        const due = new Date(row.original.next_due_at);
        const isOverdue = due < new Date();
        return <span className={isOverdue ? "text-destructive font-medium" : ""}>{due.toLocaleDateString()}</span>;
      },
    },
    {
      accessorKey: "deviation_found",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.calibrations.deviationFound")} />,
      cell: ({ row }) => row.original.deviation_found != null ? row.original.deviation_found : "—",
    },
    {
      accessorKey: "reference_standard",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.calibrations.referenceStandard")} />,
      cell: ({ row }) => row.original.reference_standard ?? "—",
    },
  ];

  const stats = {
    total: calibrations?.length ?? 0,
    passed: calibrations?.filter((c) => c.result === "pass").length ?? 0,
    failed: calibrations?.filter((c) => c.result === "fail").length ?? 0,
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10"><Gauge className="w-5 h-5 text-primary" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.calibrations.totalCalibrations")}</p>
                <p className="text-2xl font-semibold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10"><Gauge className="w-5 h-5 text-green-600" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.calibrations.passedCount")}</p>
                <p className="text-2xl font-semibold">{stats.passed}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10"><AlertTriangle className="w-5 h-5 text-destructive" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.calibrations.failedCount")}</p>
                <p className="text-2xl font-semibold">{stats.failed}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />{t("admin.productionErp.calibrations.add")}</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{t("admin.productionErp.calibrations.add")}</DialogTitle>
              <DialogDescription>{t("admin.productionErp.calibrations.formDescription")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.calibrations.equipmentId")}</Label>
                  <Input value={form.equipment_id} onChange={(e) => setForm({ ...form, equipment_id: e.target.value })} placeholder="UUID" />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.calibrations.calibrationType")}</Label>
                  <Input value={form.calibration_type} onChange={(e) => setForm({ ...form, calibration_type: e.target.value })} placeholder="e.g. IQ, OQ, PQ" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.calibrations.result")}</Label>
                  <Select value={form.result} onValueChange={(v) => setForm({ ...form, result: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pass">{t("admin.productionErp.calibrationResult.pass")}</SelectItem>
                      <SelectItem value="adjusted">{t("admin.productionErp.calibrationResult.adjusted")}</SelectItem>
                      <SelectItem value="fail">{t("admin.productionErp.calibrationResult.fail")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.calibrations.referenceStandard")}</Label>
                  <Input value={form.reference_standard} onChange={(e) => setForm({ ...form, reference_standard: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.calibrations.deviationFound")}</Label>
                  <Input type="number" step="0.01" value={form.deviation_found} onChange={(e) => setForm({ ...form, deviation_found: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.calibrations.deviationLimit")}</Label>
                  <Input type="number" step="0.01" value={form.deviation_limit} onChange={(e) => setForm({ ...form, deviation_limit: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.calibrations.nextDueAt")}</Label>
                  <Input type="date" value={form.next_due_at} onChange={(e) => setForm({ ...form, next_due_at: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("admin.productionErp.calibrations.adjustmentMade")}</Label>
                <Input value={form.adjustment_made} onChange={(e) => setForm({ ...form, adjustment_made: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.productionErp.common.notes")}</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setIsOpen(false); resetForm(); }}>{t("common.cancel")}</Button>
              <Button onClick={handleSubmit} disabled={createMutation.isPending}>
                {createMutation.isPending ? t("common.saving") : t("common.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <DataTable columns={columns} data={calibrations ?? []} searchKey="calibration_type" />
    </div>
  );
}
