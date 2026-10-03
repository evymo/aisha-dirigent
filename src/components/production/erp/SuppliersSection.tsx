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
import { Plus, Pencil, Building2, MapPin, ShieldCheck } from "lucide-react";
import {
  useProductionSuppliersAdmin,
  useUpsertProductionSupplierMutation,
  type ProductionSupplier,
} from "@/hooks";

/**
 * Suppliers management sub-component for Production ERP.
 * CRUD operations on production_suppliers table via audited RPC.
 */
export default function SuppliersSection() {
  const { t } = useTranslation();
  const { data: suppliers, isLoading } = useProductionSuppliersAdmin();
  const upsertMutation = useUpsertProductionSupplierMutation();

  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<ProductionSupplier | null>(null);
  const [form, setForm] = useState({
    supplier_code: "",
    supplier_name: "",
    country: "",
    qualification_status: "pending",
    risk_level: "medium",
    notes: "",
  });

  const resetForm = () => {
    setForm({
      supplier_code: "",
      supplier_name: "",
      country: "",
      qualification_status: "pending",
      risk_level: "medium",
      notes: "",
    });
    setEditing(null);
  };

  const handleEdit = (supplier: ProductionSupplier) => {
    setEditing(supplier);
    setForm({
      supplier_code: supplier.supplier_code,
      supplier_name: supplier.supplier_name,
      country: supplier.country ?? "",
      qualification_status: supplier.qualification_status,
      risk_level: supplier.risk_level,
      notes: supplier.notes ?? "",
    });
    setIsOpen(true);
  };

  const handleSubmit = () => {
    if (!form.supplier_code || !form.supplier_name) {
      toast.error(t("admin.productionErp.validation.requiredFields"));
      return;
    }
    upsertMutation.mutate(
      {
        id: editing?.id,
        supplier_code: form.supplier_code,
        supplier_name: form.supplier_name,
        country: form.country || null,
        qualification_status: form.qualification_status,
        risk_level: form.risk_level,
        notes: form.notes || null,
      },
      {
        onSuccess: () => {
          toast.success(
            editing
              ? t("admin.productionErp.suppliers.updated")
              : t("admin.productionErp.suppliers.created"),
          );
          setIsOpen(false);
          resetForm();
        },
        onError: () => toast.error(t("admin.productionErp.errors.saveFailed")),
      },
    );
  };

  const qualificationBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      qualified: "default",
      pending: "outline",
      conditionally_approved: "secondary",
      disqualified: "destructive",
    };
    return <Badge variant={variants[status] ?? "outline"}>{t(`admin.productionErp.qualificationStatus.${status}`)}</Badge>;
  };

  const riskBadge = (level: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      low: "default",
      medium: "secondary",
      high: "destructive",
      critical: "destructive",
    };
    return <Badge variant={variants[level] ?? "outline"}>{t(`admin.productionErp.riskLevel.${level}`)}</Badge>;
  };

  const columns: ColumnDef<ProductionSupplier>[] = [
    {
      accessorKey: "supplier_code",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("admin.productionErp.suppliers.code")} />
      ),
    },
    {
      accessorKey: "supplier_name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("admin.productionErp.suppliers.name")} />
      ),
    },
    {
      accessorKey: "country",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("admin.productionErp.suppliers.country")} />
      ),
      cell: ({ row }) => row.original.country ?? "—",
    },
    {
      accessorKey: "qualification_status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("admin.productionErp.suppliers.qualification")} />
      ),
      cell: ({ row }) => qualificationBadge(row.original.qualification_status),
    },
    {
      accessorKey: "risk_level",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("admin.productionErp.suppliers.risk")} />
      ),
      cell: ({ row }) => riskBadge(row.original.risk_level),
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
    total: suppliers?.length ?? 0,
    qualified: suppliers?.filter((s) => s.qualification_status === "qualified").length ?? 0,
    highRisk: suppliers?.filter((s) => s.risk_level === "high" || s.risk_level === "critical").length ?? 0,
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Building2 className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.suppliers.totalSuppliers")}</p>
                <p className="text-2xl font-semibold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <ShieldCheck className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.suppliers.qualifiedCount")}</p>
                <p className="text-2xl font-semibold">{stats.qualified}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10">
                <MapPin className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.suppliers.highRiskCount")}</p>
                <p className="text-2xl font-semibold">{stats.highRisk}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              {t("admin.productionErp.suppliers.add")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editing ? t("admin.productionErp.suppliers.edit") : t("admin.productionErp.suppliers.add")}
              </DialogTitle>
              <DialogDescription>{t("admin.productionErp.suppliers.formDescription")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.suppliers.code")}</Label>
                  <Input
                    value={form.supplier_code}
                    onChange={(e) => setForm({ ...form, supplier_code: e.target.value })}
                    placeholder="SUP-001"
                    disabled={!!editing}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.suppliers.country")}</Label>
                  <Input
                    value={form.country}
                    onChange={(e) => setForm({ ...form, country: e.target.value })}
                    placeholder="CZ"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("admin.productionErp.suppliers.name")}</Label>
                <Input
                  value={form.supplier_name}
                  onChange={(e) => setForm({ ...form, supplier_name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.suppliers.qualification")}</Label>
                  <Select
                    value={form.qualification_status}
                    onValueChange={(v) => setForm({ ...form, qualification_status: v })}
                  >
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
                  <Label>{t("admin.productionErp.suppliers.risk")}</Label>
                  <Select
                    value={form.risk_level}
                    onValueChange={(v) => setForm({ ...form, risk_level: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">{t("admin.productionErp.riskLevel.low")}</SelectItem>
                      <SelectItem value="medium">{t("admin.productionErp.riskLevel.medium")}</SelectItem>
                      <SelectItem value="high">{t("admin.productionErp.riskLevel.high")}</SelectItem>
                      <SelectItem value="critical">{t("admin.productionErp.riskLevel.critical")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("admin.productionErp.common.notes")}</Label>
                <Textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setIsOpen(false); resetForm(); }}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleSubmit} disabled={upsertMutation.isPending}>
                {upsertMutation.isPending ? t("common.saving") : t("common.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <DataTable columns={columns} data={suppliers ?? []} searchKey="supplier_name" />
    </div>
  );
}
