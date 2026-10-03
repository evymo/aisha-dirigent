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
import { Plus, Pencil, MapPin, Thermometer } from "lucide-react";
import {
  useProductionLocationsAdmin,
  useUpsertProductionLocationMutation,
  type ProductionLocation,
} from "@/hooks";

/**
 * Locations management sub-component for Production ERP.
 * CRUD operations on production_locations table via audited RPC.
 */
export default function LocationsSection() {
  const { t } = useTranslation();
  const { data: locations, isLoading } = useProductionLocationsAdmin();
  const upsertMutation = useUpsertProductionLocationMutation();

  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<ProductionLocation | null>(null);
  const [form, setForm] = useState({
    location_code: "",
    location_name: "",
    location_type: "plant",
    gmp_zone: "",
    temp_range_min: "",
    temp_range_max: "",
    humidity_range_min: "",
    humidity_range_max: "",
    notes: "",
  });

  const resetForm = () => {
    setForm({
      location_code: "",
      location_name: "",
      location_type: "plant",
      gmp_zone: "",
      temp_range_min: "",
      temp_range_max: "",
      humidity_range_min: "",
      humidity_range_max: "",
      notes: "",
    });
    setEditing(null);
  };

  const handleEdit = (loc: ProductionLocation) => {
    setEditing(loc);
    setForm({
      location_code: loc.location_code,
      location_name: loc.location_name,
      location_type: loc.location_type,
      gmp_zone: loc.gmp_zone ?? "",
      temp_range_min: loc.temp_range_min?.toString() ?? "",
      temp_range_max: loc.temp_range_max?.toString() ?? "",
      humidity_range_min: loc.humidity_range_min?.toString() ?? "",
      humidity_range_max: loc.humidity_range_max?.toString() ?? "",
      notes: loc.notes ?? "",
    });
    setIsOpen(true);
  };

  const handleSubmit = () => {
    if (!form.location_code || !form.location_name) {
      toast.error(t("admin.productionErp.validation.requiredFields"));
      return;
    }
    upsertMutation.mutate(
      {
        id: editing?.id,
        location_code: form.location_code,
        location_name: form.location_name,
        location_type: form.location_type,
        gmp_zone: form.gmp_zone || null,
        temp_range_min: form.temp_range_min ? Number(form.temp_range_min) : null,
        temp_range_max: form.temp_range_max ? Number(form.temp_range_max) : null,
        humidity_range_min: form.humidity_range_min ? Number(form.humidity_range_min) : null,
        humidity_range_max: form.humidity_range_max ? Number(form.humidity_range_max) : null,
        notes: form.notes || null,
      },
      {
        onSuccess: () => {
          toast.success(
            editing
              ? t("admin.productionErp.locations.updated")
              : t("admin.productionErp.locations.created"),
          );
          setIsOpen(false);
          resetForm();
        },
        onError: () => toast.error(t("admin.productionErp.errors.saveFailed")),
      },
    );
  };

  const columns: ColumnDef<ProductionLocation>[] = [
    {
      accessorKey: "location_code",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("admin.productionErp.locations.code")} />
      ),
    },
    {
      accessorKey: "location_name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("admin.productionErp.locations.name")} />
      ),
    },
    {
      accessorKey: "location_type",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("admin.productionErp.locations.type")} />
      ),
      cell: ({ row }) => (
        <Badge variant="outline">{t(`admin.productionErp.locationType.${row.original.location_type}`)}</Badge>
      ),
    },
    {
      accessorKey: "gmp_zone",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("admin.productionErp.locations.gmpZone")} />
      ),
      cell: ({ row }) => row.original.gmp_zone ?? "—",
    },
    {
      id: "tempRange",
      header: () => t("admin.productionErp.locations.tempRange"),
      cell: ({ row }) => {
        const min = row.original.temp_range_min;
        const max = row.original.temp_range_max;
        if (min == null && max == null) return "—";
        return `${min ?? "—"}°C – ${max ?? "—"}°C`;
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
    total: locations?.length ?? 0,
    warehouses: locations?.filter((l) => l.location_type === "warehouse").length ?? 0,
    cleanRooms: locations?.filter((l) => l.location_type === "cleanroom").length ?? 0,
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <MapPin className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.locations.totalLocations")}</p>
                <p className="text-2xl font-semibold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <MapPin className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.locations.warehouseCount")}</p>
                <p className="text-2xl font-semibold">{stats.warehouses}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Thermometer className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.locations.cleanRoomCount")}</p>
                <p className="text-2xl font-semibold">{stats.cleanRooms}</p>
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
              {t("admin.productionErp.locations.add")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editing ? t("admin.productionErp.locations.edit") : t("admin.productionErp.locations.add")}
              </DialogTitle>
              <DialogDescription>{t("admin.productionErp.locations.formDescription")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.locations.code")}</Label>
                  <Input
                    value={form.location_code}
                    onChange={(e) => setForm({ ...form, location_code: e.target.value })}
                    placeholder="LOC-001"
                    disabled={!!editing}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.locations.type")}</Label>
                  <Select
                    value={form.location_type}
                    onValueChange={(v) => setForm({ ...form, location_type: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="plant">{t("admin.productionErp.locationType.plant")}</SelectItem>
                      <SelectItem value="warehouse">{t("admin.productionErp.locationType.warehouse")}</SelectItem>
                      <SelectItem value="cleanroom">{t("admin.productionErp.locationType.cleanroom")}</SelectItem>
                      <SelectItem value="lab">{t("admin.productionErp.locationType.lab")}</SelectItem>
                      <SelectItem value="cold_storage">{t("admin.productionErp.locationType.cold_storage")}</SelectItem>
                      <SelectItem value="staging">{t("admin.productionErp.locationType.staging")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("admin.productionErp.locations.name")}</Label>
                <Input
                  value={form.location_name}
                  onChange={(e) => setForm({ ...form, location_name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.productionErp.locations.gmpZone")}</Label>
                <Input
                  value={form.gmp_zone}
                  onChange={(e) => setForm({ ...form, gmp_zone: e.target.value })}
                  placeholder="A / B / C / D"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.locations.tempMin")}</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={form.temp_range_min}
                    onChange={(e) => setForm({ ...form, temp_range_min: e.target.value })}
                    placeholder="2.0"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.locations.tempMax")}</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={form.temp_range_max}
                    onChange={(e) => setForm({ ...form, temp_range_max: e.target.value })}
                    placeholder="8.0"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.locations.humidityMin")}</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={form.humidity_range_min}
                    onChange={(e) => setForm({ ...form, humidity_range_min: e.target.value })}
                    placeholder="30"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.locations.humidityMax")}</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={form.humidity_range_max}
                    onChange={(e) => setForm({ ...form, humidity_range_max: e.target.value })}
                    placeholder="65"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("admin.productionErp.common.notes")}</Label>
                <Textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
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

      <DataTable columns={columns} data={locations ?? []} searchKey="location_name" />
    </div>
  );
}
