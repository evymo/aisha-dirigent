import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ColumnDef } from "@tanstack/react-table";
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
import { Plus, Pencil } from "lucide-react";
import {
  useProductionBatchMaterialsAdmin,
  useUpsertProductionBatchMaterialMutation,
  type ProductionBatchMaterial,
} from "@/hooks";

/**
 * Batch materials section for Production ERP.
 * Tracks material in/out for production batches (BOM consumption).
 */
export default function BatchMaterialsSection() {
  const { t } = useTranslation();
  const { data: materials, isLoading } = useProductionBatchMaterialsAdmin();
  const upsertMutation = useUpsertProductionBatchMaterialMutation();

  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<ProductionBatchMaterial | null>(null);
  const [form, setForm] = useState({
    batch_id: "",
    item_id: "",
    direction: "IN",
    planned_qty: "",
    actual_qty: "",
    uom: "kg",
    notes: "",
  });

  const resetForm = () => {
    setForm({ batch_id: "", item_id: "", direction: "IN", planned_qty: "", actual_qty: "", uom: "kg", notes: "" });
    setEditing(null);
  };

  const handleEdit = (mat: ProductionBatchMaterial) => {
    setEditing(mat);
    setForm({
      batch_id: mat.batch_id,
      item_id: mat.item_id,
      direction: mat.direction,
      planned_qty: mat.planned_qty?.toString() ?? "",
      actual_qty: mat.actual_qty?.toString() ?? "",
      uom: mat.uom,
      notes: mat.notes ?? "",
    });
    setIsOpen(true);
  };

  const handleSubmit = () => {
    if (!form.batch_id || !form.item_id) {
      toast.error(t("admin.productionErp.validation.requiredFields"));
      return;
    }
    upsertMutation.mutate(
      {
        id: editing?.id,
        batch_id: form.batch_id,
        item_id: form.item_id,
        direction: form.direction,
        planned_qty: form.planned_qty ? Number(form.planned_qty) : null,
        actual_qty: form.actual_qty ? Number(form.actual_qty) : null,
        uom: form.uom,
        notes: form.notes || null,
      },
      {
        onSuccess: () => {
          toast.success(editing ? t("admin.productionErp.batchMaterials.updated") : t("admin.productionErp.batchMaterials.created"));
          setIsOpen(false);
          resetForm();
        },
        onError: () => toast.error(t("admin.productionErp.errors.saveFailed")),
      },
    );
  };

  const columns: ColumnDef<ProductionBatchMaterial>[] = [
    {
      accessorKey: "batch_id",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.batchMaterials.batchId")} />,
      cell: ({ row }) => row.original.batch_id.substring(0, 8) + "...",
    },
    {
      accessorKey: "direction",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.batchMaterials.direction")} />,
      cell: ({ row }) => (
        <Badge variant={row.original.direction === "IN" ? "default" : "secondary"}>
          {row.original.direction}
        </Badge>
      ),
    },
    {
      accessorKey: "planned_qty",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.batchMaterials.plannedQty")} />,
      cell: ({ row }) => row.original.planned_qty != null ? `${row.original.planned_qty} ${row.original.uom}` : "—",
    },
    {
      accessorKey: "actual_qty",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.batchMaterials.actualQty")} />,
      cell: ({ row }) => row.original.actual_qty != null ? `${row.original.actual_qty} ${row.original.uom}` : "—",
    },
    {
      accessorKey: "variance_pct",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.batchMaterials.variance")} />,
      cell: ({ row }) => {
        const v = row.original.variance_pct;
        if (v == null) return "—";
        return (
          <Badge variant={Math.abs(v) > 5 ? "destructive" : "outline"}>
            {v > 0 ? "+" : ""}{v.toFixed(1)}%
          </Badge>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <Button variant="ghost" size="icon" onClick={() => handleEdit(row.original)}>
          <Pencil className="w-4 h-4" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />{t("admin.productionErp.batchMaterials.add")}</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editing ? t("admin.productionErp.batchMaterials.edit") : t("admin.productionErp.batchMaterials.add")}</DialogTitle>
              <DialogDescription>{t("admin.productionErp.batchMaterials.formDescription")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.batchMaterials.batchId")}</Label>
                  <Input value={form.batch_id} onChange={(e) => setForm({ ...form, batch_id: e.target.value })} placeholder="UUID" disabled={!!editing} />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.batchMaterials.itemId")}</Label>
                  <Input value={form.item_id} onChange={(e) => setForm({ ...form, item_id: e.target.value })} placeholder="UUID" disabled={!!editing} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.batchMaterials.direction")}</Label>
                  <Select value={form.direction} onValueChange={(v) => setForm({ ...form, direction: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="IN">IN</SelectItem>
                      <SelectItem value="OUT">OUT</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.batchMaterials.plannedQty")}</Label>
                  <Input type="number" step="0.01" value={form.planned_qty} onChange={(e) => setForm({ ...form, planned_qty: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.batchMaterials.actualQty")}</Label>
                  <Input type="number" step="0.01" value={form.actual_qty} onChange={(e) => setForm({ ...form, actual_qty: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("admin.productionErp.common.notes")}</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setIsOpen(false); resetForm(); }}>{t("common.cancel")}</Button>
              <Button onClick={handleSubmit} disabled={upsertMutation.isPending}>
                {upsertMutation.isPending ? t("common.saving") : t("common.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <DataTable columns={columns} data={materials ?? []} searchKey="batch_id" />
    </div>
  );
}
