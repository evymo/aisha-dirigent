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
import { Plus, Pencil, AlertOctagon, Search } from "lucide-react";
import {
  useProductionDeviationsAdmin,
  useUpsertProductionDeviationMutation,
  type ProductionDeviation,
} from "@/hooks";

/**
 * Deviations management for Production ERP.
 * Full CRUD on production_deviations with severity/status workflows.
 */
export default function DeviationsSection() {
  const { t } = useTranslation();
  const { data: deviations, isLoading } = useProductionDeviationsAdmin();
  const upsertMutation = useUpsertProductionDeviationMutation();

  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<ProductionDeviation | null>(null);
  const [form, setForm] = useState({
    deviation_number: "",
    title: "",
    description: "",
    severity: "minor",
    category: "",
    status: "open",
    root_cause: "",
    immediate_action: "",
    disposition: "",
    notes: "",
  });

  const resetForm = () => {
    setForm({ deviation_number: "", title: "", description: "", severity: "minor", category: "", status: "open", root_cause: "", immediate_action: "", disposition: "", notes: "" });
    setEditing(null);
  };

  const handleEdit = (dev: ProductionDeviation) => {
    setEditing(dev);
    setForm({
      deviation_number: dev.deviation_number,
      title: dev.title,
      description: dev.description,
      severity: dev.severity,
      category: dev.category ?? "",
      status: dev.status,
      root_cause: dev.root_cause ?? "",
      immediate_action: dev.immediate_action ?? "",
      disposition: dev.disposition ?? "",
      notes: dev.notes ?? "",
    });
    setIsOpen(true);
  };

  const handleSubmit = () => {
    if (!form.deviation_number || !form.title || !form.description) {
      toast.error(t("admin.productionErp.validation.requiredFields"));
      return;
    }
    upsertMutation.mutate(
      {
        id: editing?.id,
        deviation_number: form.deviation_number,
        title: form.title,
        description: form.description,
        severity: form.severity,
        category: form.category || null,
        status: form.status,
        root_cause: form.root_cause || null,
        immediate_action: form.immediate_action || null,
        disposition: form.disposition || null,
        notes: form.notes || null,
      },
      {
        onSuccess: () => {
          toast.success(editing ? t("admin.productionErp.deviations.updated") : t("admin.productionErp.deviations.created"));
          setIsOpen(false);
          resetForm();
        },
        onError: () => toast.error(t("admin.productionErp.errors.saveFailed")),
      },
    );
  };

  const severityBadge = (sev: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      minor: "outline",
      major: "secondary",
      critical: "destructive",
    };
    return <Badge variant={variants[sev] ?? "outline"}>{t(`admin.productionErp.severity.${sev}`)}</Badge>;
  };

  const statusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      open: "destructive",
      investigating: "secondary",
      resolved: "default",
      closed: "outline",
    };
    return <Badge variant={variants[status] ?? "outline"}>{t(`admin.productionErp.deviationStatus.${status}`)}</Badge>;
  };

  const columns: ColumnDef<ProductionDeviation>[] = [
    {
      accessorKey: "deviation_number",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.deviations.number")} />,
    },
    {
      accessorKey: "title",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.deviations.title")} />,
    },
    {
      accessorKey: "severity",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.deviations.severity")} />,
      cell: ({ row }) => severityBadge(row.original.severity),
    },
    {
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.deviations.status")} />,
      cell: ({ row }) => statusBadge(row.original.status),
    },
    {
      accessorKey: "initiated_at",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.deviations.initiatedAt")} />,
      cell: ({ row }) => new Date(row.original.initiated_at).toLocaleDateString(),
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
    total: deviations?.length ?? 0,
    open: deviations?.filter((d) => d.status === "open").length ?? 0,
    critical: deviations?.filter((d) => d.severity === "critical").length ?? 0,
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10"><AlertOctagon className="w-5 h-5 text-primary" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.deviations.totalDeviations")}</p>
                <p className="text-2xl font-semibold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10"><AlertOctagon className="w-5 h-5 text-destructive" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.deviations.openCount")}</p>
                <p className="text-2xl font-semibold">{stats.open}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10"><Search className="w-5 h-5 text-amber-600" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.deviations.criticalCount")}</p>
                <p className="text-2xl font-semibold">{stats.critical}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />{t("admin.productionErp.deviations.add")}</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editing ? t("admin.productionErp.deviations.edit") : t("admin.productionErp.deviations.add")}</DialogTitle>
              <DialogDescription>{t("admin.productionErp.deviations.formDescription")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.deviations.number")}</Label>
                  <Input value={form.deviation_number} onChange={(e) => setForm({ ...form, deviation_number: e.target.value })} placeholder="DEV-2026-001" disabled={!!editing} />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.deviations.category")}</Label>
                  <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="process / material / equipment" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("admin.productionErp.deviations.title")}</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.productionErp.deviations.description")}</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.deviations.severity")}</Label>
                  <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minor">{t("admin.productionErp.severity.minor")}</SelectItem>
                      <SelectItem value="major">{t("admin.productionErp.severity.major")}</SelectItem>
                      <SelectItem value="critical">{t("admin.productionErp.severity.critical")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.deviations.status")}</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">{t("admin.productionErp.deviationStatus.open")}</SelectItem>
                      <SelectItem value="investigating">{t("admin.productionErp.deviationStatus.investigating")}</SelectItem>
                      <SelectItem value="resolved">{t("admin.productionErp.deviationStatus.resolved")}</SelectItem>
                      <SelectItem value="closed">{t("admin.productionErp.deviationStatus.closed")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("admin.productionErp.deviations.rootCause")}</Label>
                <Textarea value={form.root_cause} onChange={(e) => setForm({ ...form, root_cause: e.target.value })} rows={2} />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.productionErp.deviations.immediateAction")}</Label>
                <Textarea value={form.immediate_action} onChange={(e) => setForm({ ...form, immediate_action: e.target.value })} rows={2} />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.productionErp.deviations.disposition")}</Label>
                <Input value={form.disposition} onChange={(e) => setForm({ ...form, disposition: e.target.value })} />
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

      <DataTable columns={columns} data={deviations ?? []} searchKey="title" />
    </div>
  );
}
