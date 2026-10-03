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
import { Plus, Pencil, Target, Calendar } from "lucide-react";
import {
  useProductionCapaAdmin,
  useUpsertProductionCapaMutation,
  type ProductionCapa,
} from "@/hooks";

/**
 * CAPA (Corrective and Preventive Action) management for Production ERP.
 */
export default function CapaSection() {
  const { t } = useTranslation();
  const { data: capas, isLoading } = useProductionCapaAdmin();
  const upsertMutation = useUpsertProductionCapaMutation();

  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<ProductionCapa | null>(null);
  const [form, setForm] = useState({
    capa_number: "",
    capa_type: "corrective",
    title: "",
    description: "",
    status: "open",
    due_date: "",
    source_deviation_id: "",
    notes: "",
  });

  const resetForm = () => {
    setForm({ capa_number: "", capa_type: "corrective", title: "", description: "", status: "open", due_date: "", source_deviation_id: "", notes: "" });
    setEditing(null);
  };

  const handleEdit = (capa: ProductionCapa) => {
    setEditing(capa);
    setForm({
      capa_number: capa.capa_number,
      capa_type: capa.capa_type,
      title: capa.title,
      description: capa.description,
      status: capa.status,
      due_date: capa.due_date?.substring(0, 10) ?? "",
      source_deviation_id: capa.source_deviation_id ?? "",
      notes: capa.notes ?? "",
    });
    setIsOpen(true);
  };

  const handleSubmit = () => {
    if (!form.capa_number || !form.title || !form.description) {
      toast.error(t("admin.productionErp.validation.requiredFields"));
      return;
    }
    upsertMutation.mutate(
      {
        id: editing?.id,
        capa_number: form.capa_number,
        capa_type: form.capa_type,
        title: form.title,
        description: form.description,
        status: form.status,
        due_date: form.due_date || null,
        source_deviation_id: form.source_deviation_id || null,
        notes: form.notes || null,
      },
      {
        onSuccess: () => {
          toast.success(editing ? t("admin.productionErp.capa.updated") : t("admin.productionErp.capa.created"));
          setIsOpen(false);
          resetForm();
        },
        onError: () => toast.error(t("admin.productionErp.errors.saveFailed")),
      },
    );
  };

  const capaTypeBadge = (type: string) => {
    const variants: Record<string, "default" | "secondary"> = {
      corrective: "default",
      preventive: "secondary",
    };
    return <Badge variant={variants[type] ?? "default"}>{t(`admin.productionErp.capaType.${type}`)}</Badge>;
  };

  const statusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      open: "destructive",
      in_progress: "secondary",
      effective: "default",
      closed: "outline",
    };
    return <Badge variant={variants[status] ?? "outline"}>{t(`admin.productionErp.capaStatus.${status}`)}</Badge>;
  };

  const columns: ColumnDef<ProductionCapa>[] = [
    {
      accessorKey: "capa_number",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.capa.number")} />,
    },
    {
      accessorKey: "capa_type",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.capa.type")} />,
      cell: ({ row }) => capaTypeBadge(row.original.capa_type),
    },
    {
      accessorKey: "title",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.capa.title")} />,
    },
    {
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.capa.status")} />,
      cell: ({ row }) => statusBadge(row.original.status),
    },
    {
      accessorKey: "due_date",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.capa.dueDate")} />,
      cell: ({ row }) => {
        const due = row.original.due_date;
        if (!due) return "—";
        const isOverdue = new Date(due) < new Date() && row.original.status !== "closed" && row.original.status !== "effective";
        return (
          <span className={isOverdue ? "text-destructive font-medium" : ""}>
            {due.substring(0, 10)}
          </span>
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

  const stats = {
    total: capas?.length ?? 0,
    open: capas?.filter((c) => c.status === "open" || c.status === "in_progress").length ?? 0,
    overdue: capas?.filter((c) => {
      if (!c.due_date || c.status === "closed" || c.status === "effective") return false;
      return new Date(c.due_date) < new Date();
    }).length ?? 0,
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10"><Target className="w-5 h-5 text-primary" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.capa.totalCapas")}</p>
                <p className="text-2xl font-semibold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10"><Target className="w-5 h-5 text-amber-600" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.capa.openCount")}</p>
                <p className="text-2xl font-semibold">{stats.open}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10"><Calendar className="w-5 h-5 text-destructive" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.capa.overdueCount")}</p>
                <p className="text-2xl font-semibold">{stats.overdue}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />{t("admin.productionErp.capa.add")}</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editing ? t("admin.productionErp.capa.edit") : t("admin.productionErp.capa.add")}</DialogTitle>
              <DialogDescription>{t("admin.productionErp.capa.formDescription")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.capa.number")}</Label>
                  <Input value={form.capa_number} onChange={(e) => setForm({ ...form, capa_number: e.target.value })} placeholder="CAPA-2026-001" disabled={!!editing} />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.capa.type")}</Label>
                  <Select value={form.capa_type} onValueChange={(v) => setForm({ ...form, capa_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="corrective">{t("admin.productionErp.capaType.corrective")}</SelectItem>
                      <SelectItem value="preventive">{t("admin.productionErp.capaType.preventive")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.capa.status")}</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">{t("admin.productionErp.capaStatus.open")}</SelectItem>
                      <SelectItem value="in_progress">{t("admin.productionErp.capaStatus.in_progress")}</SelectItem>
                      <SelectItem value="effective">{t("admin.productionErp.capaStatus.effective")}</SelectItem>
                      <SelectItem value="closed">{t("admin.productionErp.capaStatus.closed")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("admin.productionErp.capa.title")}</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.productionErp.capa.description")}</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.capa.dueDate")}</Label>
                  <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.capa.sourceDeviation")}</Label>
                  <Input value={form.source_deviation_id} onChange={(e) => setForm({ ...form, source_deviation_id: e.target.value })} placeholder="UUID" />
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

      <DataTable columns={columns} data={capas ?? []} searchKey="title" />
    </div>
  );
}
