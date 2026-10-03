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
import { Plus, Pencil, Package, AlertCircle } from "lucide-react";
import {
  useProductionLotsAdmin,
  useUpsertProductionLotMutation,
  type ProductionLot,
} from "@/hooks";

/**
 * Lots management sub-component for Production ERP.
 * CRUD operations on production_lots table via audited RPC.
 */
export default function LotsSection() {
  const { t } = useTranslation();
  const { data: lots, isLoading } = useProductionLotsAdmin();
  const upsertMutation = useUpsertProductionLotMutation();

  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<ProductionLot | null>(null);
  const [form, setForm] = useState({
    lot_number: "",
    item_id: "",
    supplier_lot: "",
    quantity: "",
    remaining_quantity: "",
    uom: "kg",
    status: "quarantine",
    expires_at: "",
    received_at: "",
    notes: "",
  });

  const resetForm = () => {
    setForm({
      lot_number: "",
      item_id: "",
      supplier_lot: "",
      quantity: "",
      remaining_quantity: "",
      uom: "kg",
      status: "quarantine",
      expires_at: "",
      received_at: "",
      notes: "",
    });
    setEditing(null);
  };

  const handleEdit = (lot: ProductionLot) => {
    setEditing(lot);
    setForm({
      lot_number: lot.lot_number,
      item_id: lot.item_id,
      supplier_lot: lot.supplier_lot ?? "",
      quantity: lot.quantity.toString(),
      remaining_quantity: lot.remaining_quantity.toString(),
      uom: lot.uom,
      status: lot.status,
      expires_at: lot.expires_at?.substring(0, 10) ?? "",
      received_at: lot.received_at?.substring(0, 10) ?? "",
      notes: lot.notes ?? "",
    });
    setIsOpen(true);
  };

  const handleSubmit = () => {
    if (!form.lot_number || !form.item_id) {
      toast.error(t("admin.productionErp.validation.requiredFields"));
      return;
    }
    upsertMutation.mutate(
      {
        id: editing?.id,
        lot_number: form.lot_number,
        item_id: form.item_id,
        supplier_lot: form.supplier_lot || null,
        quantity: form.quantity ? Number(form.quantity) : 0,
        remaining_quantity: form.remaining_quantity ? Number(form.remaining_quantity) : 0,
        uom: form.uom,
        status: form.status,
        expires_at: form.expires_at || null,
        received_at: form.received_at || null,
        notes: form.notes || null,
      },
      {
        onSuccess: () => {
          toast.success(editing ? t("admin.productionErp.lots.updated") : t("admin.productionErp.lots.created"));
          setIsOpen(false);
          resetForm();
        },
        onError: () => toast.error(t("admin.productionErp.errors.saveFailed")),
      },
    );
  };

  const statusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      released: "default",
      quarantine: "secondary",
      rejected: "destructive",
      expired: "outline",
      consumed: "outline",
    };
    return <Badge variant={variants[status] ?? "outline"}>{t(`admin.productionErp.lotStatus.${status}`)}</Badge>;
  };

  const columns: ColumnDef<ProductionLot>[] = [
    {
      accessorKey: "lot_number",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.lots.lotNumber")} />,
    },
    {
      accessorKey: "supplier_lot",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.lots.supplierLot")} />,
      cell: ({ row }) => row.original.supplier_lot ?? "—",
    },
    {
      accessorKey: "quantity",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.lots.quantity")} />,
      cell: ({ row }) => `${row.original.quantity} ${row.original.uom}`,
    },
    {
      accessorKey: "remaining_quantity",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.lots.remaining")} />,
      cell: ({ row }) => {
        const pct = row.original.quantity > 0 ? (row.original.remaining_quantity / row.original.quantity) * 100 : 0;
        return (
          <div className="flex items-center gap-2">
            <span>{row.original.remaining_quantity} {row.original.uom}</span>
            <Badge variant={pct < 20 ? "destructive" : pct < 50 ? "secondary" : "outline"}>
              {Math.round(pct)}%
            </Badge>
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.lots.status")} />,
      cell: ({ row }) => statusBadge(row.original.status),
    },
    {
      accessorKey: "expires_at",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.lots.expiresAt")} />,
      cell: ({ row }) => row.original.expires_at?.substring(0, 10) ?? "—",
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
    total: lots?.length ?? 0,
    inQuarantine: lots?.filter((l) => l.status === "quarantine").length ?? 0,
    expiringSoon: lots?.filter((l) => {
      if (!l.expires_at) return false;
      const days = (new Date(l.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      return days > 0 && days <= 30;
    }).length ?? 0,
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10"><Package className="w-5 h-5 text-primary" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.lots.totalLots")}</p>
                <p className="text-2xl font-semibold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10"><Package className="w-5 h-5 text-amber-600" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.lots.quarantineCount")}</p>
                <p className="text-2xl font-semibold">{stats.inQuarantine}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10"><AlertCircle className="w-5 h-5 text-destructive" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.lots.expiringSoon")}</p>
                <p className="text-2xl font-semibold">{stats.expiringSoon}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />{t("admin.productionErp.lots.add")}</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing ? t("admin.productionErp.lots.edit") : t("admin.productionErp.lots.add")}</DialogTitle>
              <DialogDescription>{t("admin.productionErp.lots.formDescription")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.lots.lotNumber")}</Label>
                  <Input value={form.lot_number} onChange={(e) => setForm({ ...form, lot_number: e.target.value })} placeholder="LOT-2026-001" disabled={!!editing} />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.lots.itemId")}</Label>
                  <Input value={form.item_id} onChange={(e) => setForm({ ...form, item_id: e.target.value })} placeholder="UUID" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("admin.productionErp.lots.supplierLot")}</Label>
                <Input value={form.supplier_lot} onChange={(e) => setForm({ ...form, supplier_lot: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.lots.quantity")}</Label>
                  <Input type="number" step="0.01" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.lots.remaining")}</Label>
                  <Input type="number" step="0.01" value={form.remaining_quantity} onChange={(e) => setForm({ ...form, remaining_quantity: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.lots.uom")}</Label>
                  <Select value={form.uom} onValueChange={(v) => setForm({ ...form, uom: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="kg">kg</SelectItem>
                      <SelectItem value="g">g</SelectItem>
                      <SelectItem value="l">l</SelectItem>
                      <SelectItem value="ml">ml</SelectItem>
                      <SelectItem value="pcs">pcs</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.lots.status")}</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="quarantine">{t("admin.productionErp.lotStatus.quarantine")}</SelectItem>
                      <SelectItem value="released">{t("admin.productionErp.lotStatus.released")}</SelectItem>
                      <SelectItem value="rejected">{t("admin.productionErp.lotStatus.rejected")}</SelectItem>
                      <SelectItem value="expired">{t("admin.productionErp.lotStatus.expired")}</SelectItem>
                      <SelectItem value="consumed">{t("admin.productionErp.lotStatus.consumed")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.lots.receivedAt")}</Label>
                  <Input type="date" value={form.received_at} onChange={(e) => setForm({ ...form, received_at: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.lots.expiresAt")}</Label>
                  <Input type="date" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
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

      <DataTable columns={columns} data={lots ?? []} searchKey="lot_number" />
    </div>
  );
}
