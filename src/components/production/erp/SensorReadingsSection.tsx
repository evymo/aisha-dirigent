import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Plus, Activity, AlertTriangle } from "lucide-react";
import {
  useProductionSensorReadingsAdmin,
  useCreateProductionSensorReadingMutation,
  type ProductionSensorReading,
} from "@/hooks";

/**
 * Sensor readings section for Production ERP.
 * Immutable telemetry records — create only.
 */
export default function SensorReadingsSection() {
  const { t } = useTranslation();
  const { data: readings, isLoading } = useProductionSensorReadingsAdmin();
  const createMutation = useCreateProductionSensorReadingMutation();

  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({
    sensor_code: "",
    reading_type: "",
    value: "",
    unit: "",
    location_id: "",
    equipment_id: "",
    batch_id: "",
    is_excursion: false,
    excursion_severity: "",
    source: "homeassistant",
  });

  const resetForm = () => {
    setForm({
      sensor_code: "",
      reading_type: "",
      value: "",
      unit: "",
      location_id: "",
      equipment_id: "",
      batch_id: "",
      is_excursion: false,
      excursion_severity: "",
      source: "homeassistant",
    });
  };

  const handleSubmit = () => {
    if (!form.sensor_code || !form.reading_type || !form.value || !form.unit) {
      toast.error(t("admin.productionErp.validation.requiredFields"));
      return;
    }
    createMutation.mutate(
      {
        sensor_code: form.sensor_code,
        reading_type: form.reading_type,
        value: parseFloat(form.value),
        unit: form.unit,
        location_id: form.location_id || undefined,
        equipment_id: form.equipment_id || undefined,
        batch_id: form.batch_id || undefined,
        is_excursion: form.is_excursion,
        excursion_severity: form.excursion_severity || undefined,
        source: form.source || "homeassistant",
      },
      {
        onSuccess: () => {
          toast.success(t("admin.productionErp.sensorReadings.created"));
          setIsOpen(false);
          resetForm();
        },
        onError: () => toast.error(t("admin.productionErp.errors.saveFailed")),
      },
    );
  };

  const columns: ColumnDef<ProductionSensorReading>[] = [
    {
      accessorKey: "sensor_code",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.sensorReadings.sensorCode")} />,
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.sensor_code}</span>,
    },
    {
      accessorKey: "reading_type",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.sensorReadings.readingType")} />,
    },
    {
      id: "valueDisplay",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.sensorReadings.value")} />,
      cell: ({ row }) => (
        <span className={row.original.is_excursion ? "text-destructive font-medium" : ""}>
          {row.original.value} {row.original.unit}
        </span>
      ),
    },
    {
      accessorKey: "is_excursion",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.sensorReadings.excursion")} />,
      cell: ({ row }) => {
        if (!row.original.is_excursion) return <Badge variant="outline">{t("admin.productionErp.sensorReadings.normal")}</Badge>;
        const severityVariants: Record<string, "destructive" | "secondary" | "outline"> = {
          critical: "destructive",
          major: "secondary",
          minor: "outline",
        };
        const sev = row.original.excursion_severity ?? "minor";
        return <Badge variant={severityVariants[sev] ?? "destructive"}>{sev}</Badge>;
      },
    },
    {
      accessorKey: "source",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.sensorReadings.source")} />,
      cell: ({ row }) => <Badge variant="outline">{row.original.source ?? "homeassistant"}</Badge>,
    },
    {
      accessorKey: "recorded_at",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.sensorReadings.recordedAt")} />,
      cell: ({ row }) => new Date(row.original.recorded_at).toLocaleString(),
    },
  ];

  const stats = useMemo(() => ({
    total: readings?.length ?? 0,
    excursions: readings?.filter((r) => r.is_excursion).length ?? 0,
    sources: new Set(readings?.map((r) => r.source) ?? []).size,
  }), [readings]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10"><Activity className="w-5 h-5 text-primary" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.sensorReadings.totalReadings")}</p>
                <p className="text-2xl font-semibold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10"><AlertTriangle className="w-5 h-5 text-destructive" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.sensorReadings.excursionCount")}</p>
                <p className="text-2xl font-semibold">{stats.excursions}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10"><Activity className="w-5 h-5 text-blue-600" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.sensorReadings.sourcesCount")}</p>
                <p className="text-2xl font-semibold">{stats.sources}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />{t("admin.productionErp.sensorReadings.add")}</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{t("admin.productionErp.sensorReadings.add")}</DialogTitle>
              <DialogDescription>{t("admin.productionErp.sensorReadings.formDescription")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.sensorReadings.sensorCode")}</Label>
                  <Input value={form.sensor_code} onChange={(e) => setForm({ ...form, sensor_code: e.target.value })} placeholder="e.g. TH-W01-001" />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.sensorReadings.readingType")}</Label>
                  <Select value={form.reading_type} onValueChange={(v) => setForm({ ...form, reading_type: v })}>
                    <SelectTrigger><SelectValue placeholder={t("admin.productionErp.sensorReadings.selectType")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="temperature">{t("admin.productionErp.sensorType.temperature")}</SelectItem>
                      <SelectItem value="humidity">{t("admin.productionErp.sensorType.humidity")}</SelectItem>
                      <SelectItem value="pressure">{t("admin.productionErp.sensorType.pressure")}</SelectItem>
                      <SelectItem value="particle_count">{t("admin.productionErp.sensorType.particle_count")}</SelectItem>
                      <SelectItem value="co2">{t("admin.productionErp.sensorType.co2")}</SelectItem>
                      <SelectItem value="weight">{t("admin.productionErp.sensorType.weight")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.sensorReadings.value")}</Label>
                  <Input type="number" step="0.01" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.sensorReadings.unit")}</Label>
                  <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="e.g. °C, %RH, hPa" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.sensorReadings.locationId")}</Label>
                  <Input value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })} placeholder="UUID" />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.sensorReadings.equipmentId")}</Label>
                  <Input value={form.equipment_id} onChange={(e) => setForm({ ...form, equipment_id: e.target.value })} placeholder="UUID" />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.sensorReadings.batchId")}</Label>
                  <Input value={form.batch_id} onChange={(e) => setForm({ ...form, batch_id: e.target.value })} placeholder="UUID" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 items-end">
                <div className="flex items-center gap-2 pb-2">
                  <Switch checked={form.is_excursion} onCheckedChange={(checked) => setForm({ ...form, is_excursion: checked })} id="is_excursion" />
                  <Label htmlFor="is_excursion">{t("admin.productionErp.sensorReadings.isExcursion")}</Label>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.sensorReadings.excursionSeverity")}</Label>
                  <Select value={form.excursion_severity} onValueChange={(v) => setForm({ ...form, excursion_severity: v })} disabled={!form.is_excursion}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minor">{t("admin.productionErp.severity.minor")}</SelectItem>
                      <SelectItem value="major">{t("admin.productionErp.severity.major")}</SelectItem>
                      <SelectItem value="critical">{t("admin.productionErp.severity.critical")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.sensorReadings.source")}</Label>
                  <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="homeassistant">Home Assistant</SelectItem>
                      <SelectItem value="manual">{t("admin.productionErp.sensorSource.manual")}</SelectItem>
                      <SelectItem value="plc">PLC</SelectItem>
                      <SelectItem value="scada">SCADA</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
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

      <DataTable columns={columns} data={readings ?? []} searchKey="sensor_code" />
    </div>
  );
}
