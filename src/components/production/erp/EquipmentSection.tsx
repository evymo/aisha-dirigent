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
import { Plus, Pencil, Wrench, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  useProductionEquipmentAdmin,
  useUpsertProductionEquipmentMutation,
  type ProductionEquipment,
} from "@/hooks";

/**
 * Equipment management sub-component for Production ERP.
 * CRUD operations on production_equipment table via audited RPC.
 */
export default function EquipmentSection() {
  const { t } = useTranslation();
  const { data: equipment, isLoading } = useProductionEquipmentAdmin();
  const upsertMutation = useUpsertProductionEquipmentMutation();

  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<ProductionEquipment | null>(null);
  const [form, setForm] = useState({
    asset_tag: "",
    equipment_name: "",
    model: "",
    serial_no: "",
    manufacturer: "",
    gmp_criticality: "standard",
    qualification_status: "pending",
    power_kw: "",
    notes: "",
  });

  const resetForm = () => {
    setForm({
      asset_tag: "",
      equipment_name: "",
      model: "",
      serial_no: "",
      manufacturer: "",
      gmp_criticality: "standard",
      qualification_status: "pending",
      power_kw: "",
      notes: "",
    });
    setEditing(null);
  };

  const handleEdit = (eq: ProductionEquipment) => {
    setEditing(eq);
    setForm({
      asset_tag: eq.asset_tag,
      equipment_name: eq.equipment_name,
      model: eq.model ?? "",
      serial_no: eq.serial_no ?? "",
      manufacturer: eq.manufacturer ?? "",
      gmp_criticality: eq.gmp_criticality,
      qualification_status: eq.qualification_status,
      power_kw: eq.power_kw?.toString() ?? "",
      notes: eq.notes ?? "",
    });
    setIsOpen(true);
  };

  const handleSubmit = () => {
    if (!form.asset_tag || !form.equipment_name) {
      toast.error(t("admin.productionErp.validation.requiredFields"));
      return;
    }
    upsertMutation.mutate(
      {
        id: editing?.id,
        asset_tag: form.asset_tag,
        equipment_name: form.equipment_name,
        model: form.model || null,
        serial_no: form.serial_no || null,
        manufacturer: form.manufacturer || null,
        gmp_criticality: form.gmp_criticality,
        qualification_status: form.qualification_status,
        power_kw: form.power_kw ? Number(form.power_kw) : null,
        notes: form.notes || null,
      },
      {
        onSuccess: () => {
          toast.success(
            editing
              ? t("admin.productionErp.equipment.updated")
              : t("admin.productionErp.equipment.created"),
          );
          setIsOpen(false);
          resetForm();
        },
        onError: () => toast.error(t("admin.productionErp.errors.saveFailed")),
      },
    );
  };

  const criticalityBadge = (level: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      standard: "outline",
      gmp_critical: "secondary",
      gxp_critical: "destructive",
    };
    return <Badge variant={variants[level] ?? "outline"}>{t(`admin.productionErp.gmpCriticality.${level}`)}</Badge>;
  };

  const columns: ColumnDef<ProductionEquipment>[] = [
    {
      accessorKey: "asset_tag",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("admin.productionErp.equipment.assetTag")} />
      ),
    },
    {
      accessorKey: "equipment_name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("admin.productionErp.equipment.name")} />
      ),
    },
    {
      accessorKey: "manufacturer",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("admin.productionErp.equipment.manufacturer")} />
      ),
      cell: ({ row }) => row.original.manufacturer ?? "—",
    },
    {
      accessorKey: "gmp_criticality",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("admin.productionErp.equipment.gmpCriticality")} />
      ),
      cell: ({ row }) => criticalityBadge(row.original.gmp_criticality),
    },
    {
      accessorKey: "qualification_status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("admin.productionErp.equipment.qualificationStatus")} />
      ),
      cell: ({ row }) => {
        const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
          qualified: "default",
          pending: "outline",
          conditionally_approved: "secondary",
          disqualified: "destructive",
        };
        const status = row.original.qualification_status;
        return <Badge variant={variants[status] ?? "outline"}>{t(`admin.productionErp.qualificationStatus.${status}`)}</Badge>;
      },
    },
    {
      accessorKey: "is_active",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("admin.productionErp.common.active")} />
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
        <Button variant="ghost" size="icon" onClick={() => handleEdit(row.original)}>
          <Pencil className="w-4 h-4" />
        </Button>
      ),
    },
  ];

  const stats = {
    total: equipment?.length ?? 0,
    qualified: equipment?.filter((e) => e.qualification_status === "qualified").length ?? 0,
    critical: equipment?.filter((e) => e.gmp_criticality === "gmp_critical" || e.gmp_criticality === "gxp_critical").length ?? 0,
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10"><Wrench className="w-5 h-5 text-primary" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.equipment.totalEquipment")}</p>
                <p className="text-2xl font-semibold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10"><CheckCircle2 className="w-5 h-5 text-green-600" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.equipment.qualifiedCount")}</p>
                <p className="text-2xl font-semibold">{stats.qualified}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10"><AlertTriangle className="w-5 h-5 text-amber-600" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.equipment.criticalCount")}</p>
                <p className="text-2xl font-semibold">{stats.critical}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />{t("admin.productionErp.equipment.add")}</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing ? t("admin.productionErp.equipment.edit") : t("admin.productionErp.equipment.add")}</DialogTitle>
              <DialogDescription>{t("admin.productionErp.equipment.formDescription")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.equipment.assetTag")}</Label>
                  <Input value={form.asset_tag} onChange={(e) => setForm({ ...form, asset_tag: e.target.value })} placeholder="EQ-001" disabled={!!editing} />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.equipment.name")}</Label>
                  <Input value={form.equipment_name} onChange={(e) => setForm({ ...form, equipment_name: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.equipment.manufacturer")}</Label>
                  <Input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.equipment.model")}</Label>
                  <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.equipment.serialNo")}</Label>
                  <Input value={form.serial_no} onChange={(e) => setForm({ ...form, serial_no: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.equipment.gmpCriticality")}</Label>
                  <Select value={form.gmp_criticality} onValueChange={(v) => setForm({ ...form, gmp_criticality: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">{t("admin.productionErp.gmpCriticality.standard")}</SelectItem>
                      <SelectItem value="gmp_critical">{t("admin.productionErp.gmpCriticality.gmp_critical")}</SelectItem>
                      <SelectItem value="gxp_critical">{t("admin.productionErp.gmpCriticality.gxp_critical")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.equipment.qualificationStatus")}</Label>
                  <Select value={form.qualification_status} onValueChange={(v) => setForm({ ...form, qualification_status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">{t("admin.productionErp.qualificationStatus.pending")}</SelectItem>
                      <SelectItem value="qualified">{t("admin.productionErp.qualificationStatus.qualified")}</SelectItem>
                      <SelectItem value="conditionally_approved">{t("admin.productionErp.qualificationStatus.conditionally_approved")}</SelectItem>
                      <SelectItem value="disqualified">{t("admin.productionErp.qualificationStatus.disqualified")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.equipment.powerKw")}</Label>
                  <Input type="number" step="0.01" value={form.power_kw} onChange={(e) => setForm({ ...form, power_kw: e.target.value })} />
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

      <DataTable columns={columns} data={equipment ?? []} searchKey="equipment_name" />
    </div>
  );
}
