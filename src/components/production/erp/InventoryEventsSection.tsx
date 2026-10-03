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
import { Plus, ArrowDownUp } from "lucide-react";
import {
  useProductionInventoryEventsAdmin,
  useCreateProductionInventoryEventMutation,
  type ProductionInventoryEvent,
} from "@/hooks";

/**
 * Inventory events section for Production ERP.
 * Immutable records — create only, no edit/delete.
 */
export default function InventoryEventsSection() {
  const { t } = useTranslation();
  const { data: events, isLoading } = useProductionInventoryEventsAdmin();
  const createMutation = useCreateProductionInventoryEventMutation();

  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({
    lot_id: "",
    event_type: "receipt",
    quantity: "",
    uom: "kg",
    reason: "",
  });

  const resetForm = () => {
    setForm({ lot_id: "", event_type: "receipt", quantity: "", uom: "kg", reason: "" });
  };

  const handleSubmit = () => {
    if (!form.lot_id || !form.quantity) {
      toast.error(t("admin.productionErp.validation.requiredFields"));
      return;
    }
    createMutation.mutate(
      {
        lot_id: form.lot_id,
        event_type: form.event_type,
        quantity: Number(form.quantity),
        uom: form.uom,
        reason: form.reason || undefined,
      },
      {
        onSuccess: () => {
          toast.success(t("admin.productionErp.inventoryEvents.created"));
          setIsOpen(false);
          resetForm();
        },
        onError: () => toast.error(t("admin.productionErp.errors.saveFailed")),
      },
    );
  };

  const eventTypeBadge = (type: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      receipt: "default",
      consumption: "secondary",
      adjustment: "outline",
      return: "outline",
      scrap: "destructive",
      transfer: "secondary",
    };
    return <Badge variant={variants[type] ?? "outline"}>{t(`admin.productionErp.eventType.${type}`)}</Badge>;
  };

  const columns: ColumnDef<ProductionInventoryEvent>[] = [
    {
      accessorKey: "performed_at",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.inventoryEvents.performedAt")} />,
      cell: ({ row }) => new Date(row.original.performed_at).toLocaleString(),
    },
    {
      accessorKey: "event_type",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.inventoryEvents.eventType")} />,
      cell: ({ row }) => eventTypeBadge(row.original.event_type),
    },
    {
      accessorKey: "quantity",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.inventoryEvents.quantity")} />,
      cell: ({ row }) => `${row.original.quantity > 0 ? "+" : ""}${row.original.quantity} ${row.original.uom}`,
    },
    {
      accessorKey: "lot_id",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.inventoryEvents.lotId")} />,
      cell: ({ row }) => row.original.lot_id.substring(0, 8) + "...",
    },
    {
      accessorKey: "reason",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.inventoryEvents.reason")} />,
      cell: ({ row }) => row.original.reason ?? "—",
    },
  ];

  const stats = {
    total: events?.length ?? 0,
    receipts: events?.filter((e) => e.event_type === "receipt").length ?? 0,
    scrap: events?.filter((e) => e.event_type === "scrap").length ?? 0,
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10"><ArrowDownUp className="w-5 h-5 text-primary" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.inventoryEvents.totalEvents")}</p>
                <p className="text-2xl font-semibold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10"><ArrowDownUp className="w-5 h-5 text-green-600" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.inventoryEvents.receiptCount")}</p>
                <p className="text-2xl font-semibold">{stats.receipts}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10"><ArrowDownUp className="w-5 h-5 text-destructive" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.inventoryEvents.scrapCount")}</p>
                <p className="text-2xl font-semibold">{stats.scrap}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />{t("admin.productionErp.inventoryEvents.add")}</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t("admin.productionErp.inventoryEvents.add")}</DialogTitle>
              <DialogDescription>{t("admin.productionErp.inventoryEvents.formDescription")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label>{t("admin.productionErp.inventoryEvents.lotId")}</Label>
                <Input value={form.lot_id} onChange={(e) => setForm({ ...form, lot_id: e.target.value })} placeholder="UUID" />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.inventoryEvents.eventType")}</Label>
                  <Select value={form.event_type} onValueChange={(v) => setForm({ ...form, event_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="receipt">{t("admin.productionErp.eventType.receipt")}</SelectItem>
                      <SelectItem value="consumption">{t("admin.productionErp.eventType.consumption")}</SelectItem>
                      <SelectItem value="adjustment">{t("admin.productionErp.eventType.adjustment")}</SelectItem>
                      <SelectItem value="return">{t("admin.productionErp.eventType.return")}</SelectItem>
                      <SelectItem value="scrap">{t("admin.productionErp.eventType.scrap")}</SelectItem>
                      <SelectItem value="transfer">{t("admin.productionErp.eventType.transfer")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.inventoryEvents.quantity")}</Label>
                  <Input type="number" step="0.01" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
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
              <div className="space-y-2">
                <Label>{t("admin.productionErp.inventoryEvents.reason")}</Label>
                <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={2} />
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

      <DataTable columns={columns} data={events ?? []} searchKey="event_type" />
    </div>
  );
}
