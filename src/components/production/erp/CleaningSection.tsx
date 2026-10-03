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
import { Plus, Sparkles, CheckCircle } from "lucide-react";
import {
  useProductionEquipmentCleaningAdmin,
  useCreateProductionEquipmentCleaningMutation,
  type ProductionEquipmentCleaning,
} from "@/hooks";

/**
 * Equipment cleaning section for Production ERP.
 * Immutable GMP records — create only.
 */
export default function CleaningSection() {
  const { t } = useTranslation();
  const { data: records, isLoading } = useProductionEquipmentCleaningAdmin();
  const createMutation = useCreateProductionEquipmentCleaningMutation();

  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({
    equipment_id: "",
    cleaning_method: "",
    cleaning_agent: "",
    visual_inspection: "",
    status: "completed",
    batch_id_before: "",
    batch_id_after: "",
    notes: "",
  });

  const resetForm = () => {
    setForm({
      equipment_id: "",
      cleaning_method: "",
      cleaning_agent: "",
      visual_inspection: "",
      status: "completed",
      batch_id_before: "",
      batch_id_after: "",
      notes: "",
    });
  };

  const handleSubmit = () => {
    if (!form.equipment_id || !form.cleaning_method) {
      toast.error(t("admin.productionErp.validation.requiredFields"));
      return;
    }
    createMutation.mutate(
      {
        equipment_id: form.equipment_id,
        cleaning_method: form.cleaning_method,
        cleaning_agent: form.cleaning_agent || undefined,
        visual_inspection: form.visual_inspection || undefined,
        status: form.status || "completed",
        batch_id_before: form.batch_id_before || undefined,
        batch_id_after: form.batch_id_after || undefined,
        notes: form.notes || undefined,
      },
      {
        onSuccess: () => {
          toast.success(t("admin.productionErp.cleaning.created"));
          setIsOpen(false);
          resetForm();
        },
        onError: () => toast.error(t("admin.productionErp.errors.saveFailed")),
      },
    );
  };

  const statusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      completed: "default",
      failed: "destructive",
      pending: "secondary",
    };
    return <Badge variant={variants[status] ?? "outline"}>{t(`admin.productionErp.cleaningStatus.${status}`)}</Badge>;
  };

  const columns: ColumnDef<ProductionEquipmentCleaning>[] = [
    {
      accessorKey: "equipment_id",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.cleaning.equipmentId")} />,
      cell: ({ row }) => row.original.equipment_id.substring(0, 8) + "...",
    },
    {
      accessorKey: "cleaning_method",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.cleaning.method")} />,
    },
    {
      accessorKey: "cleaning_agent",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.cleaning.agent")} />,
      cell: ({ row }) => row.original.cleaning_agent ?? "—",
    },
    {
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.cleaning.status")} />,
      cell: ({ row }) => statusBadge(row.original.status),
    },
    {
      accessorKey: "visual_inspection",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.cleaning.visualInspection")} />,
      cell: ({ row }) => row.original.visual_inspection ?? "—",
    },
    {
      accessorKey: "performed_at",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.cleaning.performedAt")} />,
      cell: ({ row }) => new Date(row.original.performed_at).toLocaleString(),
    },
  ];

  const stats = {
    total: records?.length ?? 0,
    completed: records?.filter((r) => r.status === "completed").length ?? 0,
    failed: records?.filter((r) => r.status === "failed").length ?? 0,
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10"><Sparkles className="w-5 h-5 text-primary" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.cleaning.totalRecords")}</p>
                <p className="text-2xl font-semibold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10"><CheckCircle className="w-5 h-5 text-green-600" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.cleaning.completedCount")}</p>
                <p className="text-2xl font-semibold">{stats.completed}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10"><Sparkles className="w-5 h-5 text-destructive" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.cleaning.failedCount")}</p>
                <p className="text-2xl font-semibold">{stats.failed}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />{t("admin.productionErp.cleaning.add")}</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{t("admin.productionErp.cleaning.add")}</DialogTitle>
              <DialogDescription>{t("admin.productionErp.cleaning.formDescription")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.cleaning.equipmentId")}</Label>
                  <Input value={form.equipment_id} onChange={(e) => setForm({ ...form, equipment_id: e.target.value })} placeholder="UUID" />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.cleaning.method")}</Label>
                  <Input value={form.cleaning_method} onChange={(e) => setForm({ ...form, cleaning_method: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.cleaning.agent")}</Label>
                  <Input value={form.cleaning_agent} onChange={(e) => setForm({ ...form, cleaning_agent: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.cleaning.status")}</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="completed">{t("admin.productionErp.cleaningStatus.completed")}</SelectItem>
                      <SelectItem value="pending">{t("admin.productionErp.cleaningStatus.pending")}</SelectItem>
                      <SelectItem value="failed">{t("admin.productionErp.cleaningStatus.failed")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("admin.productionErp.cleaning.visualInspection")}</Label>
                <Input value={form.visual_inspection} onChange={(e) => setForm({ ...form, visual_inspection: e.target.value })} placeholder={t("admin.productionErp.cleaning.visualInspectionPlaceholder")} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.cleaning.batchBefore")}</Label>
                  <Input value={form.batch_id_before} onChange={(e) => setForm({ ...form, batch_id_before: e.target.value })} placeholder="UUID" />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.cleaning.batchAfter")}</Label>
                  <Input value={form.batch_id_after} onChange={(e) => setForm({ ...form, batch_id_after: e.target.value })} placeholder="UUID" />
                </div>
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

      <DataTable columns={columns} data={records ?? []} searchKey="cleaning_method" />
    </div>
  );
}
