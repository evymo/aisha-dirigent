import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import { Plus, TestTubes, Pencil } from "lucide-react";
import {
  useProductionQcTestDefinitionsAdmin,
  useUpsertProductionQcTestDefinitionMutation,
  type ProductionQcTestDefinition,
} from "@/hooks";

/**
 * QC test definitions section for Production ERP.
 * Mutable master data — CRUD with upsert.
 */
export default function QcTestDefinitionsSection() {
  const { t } = useTranslation();
  const { data: definitions, isLoading } = useProductionQcTestDefinitionsAdmin();
  const mutation = useUpsertProductionQcTestDefinitionMutation();

  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<ProductionQcTestDefinition | null>(null);
  const [form, setForm] = useState({
    test_code: "",
    test_name: "",
    method_ref: "",
    description: "",
    units: "",
    spec_limit_low: "",
    spec_limit_high: "",
    target_value: "",
    frequency: "per_batch",
    version: "1.0",
    is_active: true,
    notes: "",
  });

  const resetForm = () => {
    setEditing(null);
    setForm({
      test_code: "",
      test_name: "",
      method_ref: "",
      description: "",
      units: "",
      spec_limit_low: "",
      spec_limit_high: "",
      target_value: "",
      frequency: "per_batch",
      version: "1.0",
      is_active: true,
      notes: "",
    });
  };

  const handleEdit = (row: ProductionQcTestDefinition) => {
    setEditing(row);
    setForm({
      test_code: row.test_code,
      test_name: row.test_name,
      method_ref: row.method_ref ?? "",
      description: row.description ?? "",
      units: row.units ?? "",
      spec_limit_low: row.spec_limit_low != null ? String(row.spec_limit_low) : "",
      spec_limit_high: row.spec_limit_high != null ? String(row.spec_limit_high) : "",
      target_value: row.target_value != null ? String(row.target_value) : "",
      frequency: row.frequency ?? "per_batch",
      version: row.version ?? "1.0",
      is_active: row.is_active ?? true,
      notes: row.notes ?? "",
    });
    setIsOpen(true);
  };

  const handleSubmit = () => {
    if (!form.test_code || !form.test_name) {
      toast.error(t("admin.productionErp.validation.requiredFields"));
      return;
    }
    mutation.mutate(
      {
        id: editing?.id ?? undefined,
        test_code: form.test_code,
        test_name: form.test_name,
        method_ref: form.method_ref || undefined,
        description: form.description || undefined,
        units: form.units || undefined,
        spec_limit_low: form.spec_limit_low ? parseFloat(form.spec_limit_low) : undefined,
        spec_limit_high: form.spec_limit_high ? parseFloat(form.spec_limit_high) : undefined,
        target_value: form.target_value ? parseFloat(form.target_value) : undefined,
        frequency: form.frequency || "per_batch",
        version: form.version || "1.0",
        is_active: form.is_active,
        notes: form.notes || undefined,
      },
      {
        onSuccess: () => {
          toast.success(
            editing
              ? t("admin.productionErp.qcTestDefinitions.updated")
              : t("admin.productionErp.qcTestDefinitions.created"),
          );
          setIsOpen(false);
          resetForm();
        },
        onError: () => toast.error(t("admin.productionErp.errors.saveFailed")),
      },
    );
  };

  const columns: ColumnDef<ProductionQcTestDefinition>[] = [
    {
      accessorKey: "test_code",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.qcTestDefinitions.testCode")} />,
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.test_code}</span>,
    },
    {
      accessorKey: "test_name",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.qcTestDefinitions.testName")} />,
    },
    {
      accessorKey: "method_ref",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.qcTestDefinitions.methodRef")} />,
      cell: ({ row }) => row.original.method_ref ?? "—",
    },
    {
      id: "specRange",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.qcTestDefinitions.specRange")} />,
      cell: ({ row }) => {
        const lo = row.original.spec_limit_low;
        const hi = row.original.spec_limit_high;
        const tgt = row.original.target_value;
        if (lo == null && hi == null) return "—";
        const range = `${lo ?? "—"} – ${hi ?? "—"}`;
        return tgt != null ? `${range} (${tgt})` : range;
      },
    },
    {
      accessorKey: "units",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.qcTestDefinitions.units")} />,
      cell: ({ row }) => row.original.units ?? "—",
    },
    {
      accessorKey: "frequency",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.qcTestDefinitions.frequency")} />,
      cell: ({ row }) => <Badge variant="outline">{row.original.frequency ?? "per_batch"}</Badge>,
    },
    {
      accessorKey: "version",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.qcTestDefinitions.version")} />,
      cell: ({ row }) => row.original.version ?? "1.0",
    },
    {
      accessorKey: "is_active",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.qcTestDefinitions.isActive")} />,
      cell: ({ row }) => (
        <Badge variant={row.original.is_active ? "default" : "secondary"}>
          {row.original.is_active ? t("admin.productionErp.common.active") : t("admin.productionErp.common.inactive")}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: t("admin.productionErp.common.actions"),
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => handleEdit(row.original)}>
          <Pencil className="w-4 h-4" />
        </Button>
      ),
    },
  ];

  const stats = useMemo(() => ({
    total: definitions?.length ?? 0,
    active: definitions?.filter((d) => d.is_active).length ?? 0,
    withSpecs: definitions?.filter((d) => d.spec_limit_low != null || d.spec_limit_high != null).length ?? 0,
  }), [definitions]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10"><TestTubes className="w-5 h-5 text-primary" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.qcTestDefinitions.totalDefinitions")}</p>
                <p className="text-2xl font-semibold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10"><TestTubes className="w-5 h-5 text-green-600" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.qcTestDefinitions.activeCount")}</p>
                <p className="text-2xl font-semibold">{stats.active}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10"><TestTubes className="w-5 h-5 text-blue-600" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.qcTestDefinitions.withSpecsCount")}</p>
                <p className="text-2xl font-semibold">{stats.withSpecs}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />{t("admin.productionErp.qcTestDefinitions.add")}</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editing ? t("admin.productionErp.qcTestDefinitions.edit") : t("admin.productionErp.qcTestDefinitions.add")}
              </DialogTitle>
              <DialogDescription>{t("admin.productionErp.qcTestDefinitions.formDescription")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.qcTestDefinitions.testCode")}</Label>
                  <Input value={form.test_code} onChange={(e) => setForm({ ...form, test_code: e.target.value })} disabled={!!editing} />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>{t("admin.productionErp.qcTestDefinitions.testName")}</Label>
                  <Input value={form.test_name} onChange={(e) => setForm({ ...form, test_name: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.qcTestDefinitions.methodRef")}</Label>
                  <Input value={form.method_ref} onChange={(e) => setForm({ ...form, method_ref: e.target.value })} placeholder="e.g. Ph.Eur. 2.2.1" />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.qcTestDefinitions.units")}</Label>
                  <Input value={form.units} onChange={(e) => setForm({ ...form, units: e.target.value })} placeholder="e.g. mg/ml, pH, %" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("admin.productionErp.qcTestDefinitions.description")}</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.qcTestDefinitions.specLimitLow")}</Label>
                  <Input type="number" step="0.001" value={form.spec_limit_low} onChange={(e) => setForm({ ...form, spec_limit_low: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.qcTestDefinitions.targetValue")}</Label>
                  <Input type="number" step="0.001" value={form.target_value} onChange={(e) => setForm({ ...form, target_value: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.qcTestDefinitions.specLimitHigh")}</Label>
                  <Input type="number" step="0.001" value={form.spec_limit_high} onChange={(e) => setForm({ ...form, spec_limit_high: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.qcTestDefinitions.frequency")}</Label>
                  <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="per_batch">{t("admin.productionErp.qcFrequency.per_batch")}</SelectItem>
                      <SelectItem value="per_lot">{t("admin.productionErp.qcFrequency.per_lot")}</SelectItem>
                      <SelectItem value="daily">{t("admin.productionErp.qcFrequency.daily")}</SelectItem>
                      <SelectItem value="weekly">{t("admin.productionErp.qcFrequency.weekly")}</SelectItem>
                      <SelectItem value="monthly">{t("admin.productionErp.qcFrequency.monthly")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.qcTestDefinitions.version")}</Label>
                  <Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
                </div>
                <div className="flex items-end pb-2 gap-2">
                  <Switch checked={form.is_active} onCheckedChange={(checked) => setForm({ ...form, is_active: checked })} id="is_active" />
                  <Label htmlFor="is_active">{t("admin.productionErp.qcTestDefinitions.isActive")}</Label>
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("admin.productionErp.common.notes")}</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setIsOpen(false); resetForm(); }}>{t("common.cancel")}</Button>
              <Button onClick={handleSubmit} disabled={mutation.isPending}>
                {mutation.isPending ? t("common.saving") : t("common.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <DataTable columns={columns} data={definitions ?? []} searchKey="test_name" />
    </div>
  );
}
