/**
 * @fileoverview Flow Substances management section.
 * CRUD for tracked materials (ethanol, water, extracts, intermediates).
 * All operations via audited RPC through useAdminProductionFlow hook.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Plus, Pencil, FlaskConical, Beaker, ShieldAlert } from "lucide-react";
import {
  useFlowSubstancesAdmin,
  useUpsertFlowSubstanceMutation,
  type FlowSubstance,
} from "@/hooks";

interface FlowSubstanceForm {
  cas_number: string;
  default_concentration_pct: number;
  default_unit: string;
  density_kg_l: string;
  is_active: boolean;
  notes: string;
  regulatory_class: string;
  substance_code: string;
  substance_name: string;
}

const defaultForm: FlowSubstanceForm = {
  cas_number: "",
  default_concentration_pct: 100,
  default_unit: "l",
  density_kg_l: "",
  is_active: true,
  notes: "",
  regulatory_class: "",
  substance_code: "",
  substance_name: "",
};

/**
 * Substances management sub-component for Flow Tracking.
 * Manages tracked materials master data (ethanol, water, extracts, etc.).
 */
export default function FlowSubstancesSection() {
  const { t } = useTranslation();
  const { data: substances, isLoading } = useFlowSubstancesAdmin();
  const upsertMutation = useUpsertFlowSubstanceMutation();

  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<FlowSubstance | null>(null);
  const [form, setForm] = useState<FlowSubstanceForm>(defaultForm);

  const resetForm = () => {
    setForm(defaultForm);
    setEditing(null);
  };

  const handleEdit = (substance: FlowSubstance) => {
    setEditing(substance);
    setForm({
      cas_number: substance.cas_number ?? "",
      default_concentration_pct: substance.default_concentration_pct ?? 100,
      default_unit: substance.default_unit ?? "l",
      density_kg_l: substance.density_kg_l?.toString() ?? "",
      is_active: substance.is_active,
      notes: substance.notes ?? "",
      regulatory_class: substance.regulatory_class ?? "",
      substance_code: substance.substance_code,
      substance_name: substance.substance_name,
    });
    setIsOpen(true);
  };

  const handleSubmit = () => {
    if (!form.substance_code || !form.substance_name) {
      toast.error(t("admin.production.flow.validation.requiredFields"));
      return;
    }
    upsertMutation.mutate(
      {
        id: editing?.id,
        cas_number: form.cas_number || null,
        default_concentration_pct: form.default_concentration_pct,
        default_unit: form.default_unit || "l",
        density_kg_l: form.density_kg_l ? parseFloat(form.density_kg_l) : null,
        is_active: form.is_active,
        notes: form.notes || null,
        regulatory_class: form.regulatory_class || null,
        substance_code: form.substance_code,
        substance_name: form.substance_name,
      },
      {
        onSuccess: () => {
          toast.success(
            editing
              ? t("admin.production.flow.substances.updated")
              : t("admin.production.flow.substances.created"),
          );
          setIsOpen(false);
          resetForm();
        },
        onError: () =>
          toast.error(t("admin.production.flow.errors.saveFailed")),
      },
    );
  };

  const regulatoryBadge = (cls: string | null) => {
    if (!cls) return <span className="text-muted-foreground">—</span>;
    const variants: Record<
      string,
      "default" | "secondary" | "destructive" | "outline"
    > = {
      excise: "destructive",
      controlled: "secondary",
      standard: "default",
    };
    return (
      <Badge variant={variants[cls] ?? "outline"}>
        {t(`admin.production.flow.regulatoryClass.${cls}`)}
      </Badge>
    );
  };

  const columns: ColumnDef<FlowSubstance>[] = [
    {
      accessorKey: "substance_code",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.substances.code")}
        />
      ),
    },
    {
      accessorKey: "substance_name",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.substances.name")}
        />
      ),
    },
    {
      accessorKey: "cas_number",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.substances.casNumber")}
        />
      ),
      cell: ({ row }) => row.original.cas_number ?? "—",
    },
    {
      accessorKey: "regulatory_class",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.substances.regulatoryClass")}
        />
      ),
      cell: ({ row }) => regulatoryBadge(row.original.regulatory_class),
    },
    {
      accessorKey: "default_concentration_pct",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.substances.defaultConcentration")}
        />
      ),
      cell: ({ row }) =>
        row.original.default_concentration_pct != null
          ? `${row.original.default_concentration_pct}%`
          : "—",
    },
    {
      accessorKey: "density_kg_l",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.substances.density")}
        />
      ),
      cell: ({ row }) =>
        row.original.density_kg_l != null
          ? `${row.original.density_kg_l} kg/l`
          : "—",
    },
    {
      accessorKey: "is_active",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("admin.production.flow.common.active")}
        />
      ),
      cell: ({ row }) => (
        <Badge variant={row.original.is_active ? "default" : "outline"}>
          {row.original.is_active ? t("common.yes") : t("common.no")}
        </Badge>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => handleEdit(row.original)}
        >
          <Pencil className="w-4 h-4" />
        </Button>
      ),
    },
  ];

  const stats = {
    total: substances?.length ?? 0,
    excise:
      substances?.filter((s) => s.regulatory_class === "excise").length ?? 0,
    active: substances?.filter((s) => s.is_active).length ?? 0,
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <FlaskConical className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("admin.production.flow.substances.totalSubstances")}
                </p>
                <p className="text-2xl font-semibold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10">
                <ShieldAlert className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("admin.production.flow.substances.exciseCount")}
                </p>
                <p className="text-2xl font-semibold">{stats.excise}</p>
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
                  {t("admin.production.flow.substances.activeCount")}
                </p>
                <p className="text-2xl font-semibold">{stats.active}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Dialog
          open={isOpen}
          onOpenChange={(open) => {
            setIsOpen(open);
            if (!open) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              {t("admin.production.flow.substances.add")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editing
                  ? t("admin.production.flow.substances.edit")
                  : t("admin.production.flow.substances.add")}
              </DialogTitle>
              <DialogDescription>
                {t("admin.production.flow.substances.formDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>
                    {t("admin.production.flow.substances.code")}
                  </Label>
                  <Input
                    value={form.substance_code}
                    onChange={(e) =>
                      setForm({ ...form, substance_code: e.target.value })
                    }
                    placeholder="ETH-96"
                    disabled={!!editing}
                  />
                </div>
                <div className="space-y-2">
                  <Label>
                    {t("admin.production.flow.substances.casNumber")}
                  </Label>
                  <Input
                    value={form.cas_number}
                    onChange={(e) =>
                      setForm({ ...form, cas_number: e.target.value })
                    }
                    placeholder="64-17-5"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>
                  {t("admin.production.flow.substances.name")}
                </Label>
                <Input
                  value={form.substance_name}
                  onChange={(e) =>
                    setForm({ ...form, substance_name: e.target.value })
                  }
                  placeholder={t("admin.production.flow.substances.namePlaceholder")}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>
                    {t("admin.production.flow.substances.defaultConcentration")}
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={form.default_concentration_pct}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        default_concentration_pct: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>
                    {t("admin.production.flow.substances.density")}
                  </Label>
                  <Input
                    type="number"
                    step={0.001}
                    value={form.density_kg_l}
                    onChange={(e) =>
                      setForm({ ...form, density_kg_l: e.target.value })
                    }
                    placeholder="0.789"
                  />
                </div>
                <div className="space-y-2">
                  <Label>
                    {t("admin.production.flow.substances.unit")}
                  </Label>
                  <Input
                    value={form.default_unit}
                    onChange={(e) =>
                      setForm({ ...form, default_unit: e.target.value })
                    }
                    placeholder="l"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>
                  {t("admin.production.flow.substances.regulatoryClass")}
                </Label>
                <Input
                  value={form.regulatory_class}
                  onChange={(e) =>
                    setForm({ ...form, regulatory_class: e.target.value })
                  }
                  placeholder="excise / controlled / standard"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.production.flow.common.notes")}</Label>
                <Textarea
                  value={form.notes}
                  onChange={(e) =>
                    setForm({ ...form, notes: e.target.value })
                  }
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setIsOpen(false);
                  resetForm();
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={upsertMutation.isPending}
              >
                {upsertMutation.isPending
                  ? t("common.saving")
                  : t("common.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <DataTable
        columns={columns}
        data={substances ?? []}
        searchKey="substance_name"
      />
    </div>
  );
}
