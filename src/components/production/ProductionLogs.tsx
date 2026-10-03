import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Plus,
  Filter,
  Download,
  Droplet,
  Leaf,
  FlaskConical,
  Thermometer,
  RefreshCw,
} from "lucide-react";
import {
  useProductionLogsAdmin,
  useActiveBatches,
  useCreateProductionLog,
  type LogFormData,
} from "@/hooks/useProductionLogs";

const LOG_TYPES = [
  "measurement",
  "operation",
  "transfer",
  "quality_check",
  "deviation",
  "automation",
  "manual",
] as const;
const LOG_CATEGORIES = [
  "alcohol",
  "blood",
  "herb",
  "water",
  "product",
  "waste",
  "regeneration",
] as const;

const defaultFormData: LogFormData = {
  batch_id: null,
  log_type: "measurement",
  log_category: "alcohol",
  title: "",
  description: "",
  input_volume: "",
  input_concentration: "",
  output_volume: "",
  output_concentration: "",
  loss_volume: "",
  waste_volume: "",
  material_lot: "",
  source_container: "",
  target_container: "",
  temperature: "",
  notes: "",
};

export default function ProductionLogs() {
  const { t } = useTranslation();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [formData, setFormData] = useState<LogFormData>(defaultFormData);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const { data: logs, isLoading } = useProductionLogsAdmin({
    categoryFilter,
    typeFilter,
  });
  const { data: batches } = useActiveBatches();
  const createLogMutation = useCreateProductionLog();

  const handleCreate = () => {
    createLogMutation.mutate(formData, {
      onSuccess: () => {
        setIsCreateOpen(false);
        setFormData(defaultFormData);
        toast.success(t("admin.production.logs.created"));
      },
      onError: () => toast.error(t("admin.production.logs.errors.createFailed")),
    });
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "alcohol":
        return <Droplet className="w-4 h-4" />;
      case "blood":
        return <FlaskConical className="w-4 h-4" />;
      case "herb":
        return <Leaf className="w-4 h-4" />;
      case "regeneration":
        return <RefreshCw className="w-4 h-4" />;
      default:
        return <Thermometer className="w-4 h-4" />;
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "alcohol":
        return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";
      case "blood":
        return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
      case "herb":
        return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
      case "regeneration":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const exportLogs = () => {
    if (!logs) return;
    if (typeof document === "undefined") return;

    const csv = [
      [
        "Date",
        "Batch",
        "Category",
        "Type",
        "Title",
        "Input Vol",
        "Input %",
        "Output Vol",
        "Output %",
        "Loss",
        "Waste",
        "Notes",
      ],
      ...logs.map((log) => [
        new Date(log.performed_at).toLocaleString(),
        log.batch_code || "",
        log.log_category,
        log.log_type,
        log.description || "",
        log.input_volume || "",
        log.input_concentration || "",
        log.output_volume || "",
        log.output_concentration || "",
        log.loss_volume || "",
        log.waste_volume || "",
        log.notes || "",
      ]),
    ]
      .map((row) => row.join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `production-logs-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{t("admin.production.logs.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("admin.production.logs.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportLogs}>
            <Download className="w-4 h-4 mr-2" />
            {t("common.export")}
          </Button>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                {t("admin.production.logs.addLog")}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{t("admin.production.logs.addLog")}</DialogTitle>
                <DialogDescription>{t("admin.production.logs.addDescription")}</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.production.logs.batch")}</Label>
                  <Select
                    value={formData.batch_id || "none"}
                    onValueChange={(v) =>
                      setFormData({ ...formData, batch_id: v === "none" ? null : v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("common.none")}</SelectItem>
                      {batches?.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.batch_code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.production.logs.category")} *</Label>
                  <Select
                    value={formData.log_category}
                    onValueChange={(v) => setFormData({ ...formData, log_category: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LOG_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {t(`admin.production.logs.categories.${c}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.production.logs.type")} *</Label>
                  <Select
                    value={formData.log_type}
                    onValueChange={(v) => setFormData({ ...formData, log_type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LOG_TYPES.map((logType) => (
                        <SelectItem key={logType} value={logType}>
                          {logType}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.production.logs.materialLot")}</Label>
                  <Input
                    value={formData.material_lot}
                    onChange={(e) => setFormData({ ...formData, material_lot: e.target.value })}
                  />
                </div>
                <div className="col-span-2 space-y-2">
                  <Label>{t("admin.production.logs.title")} *</Label>
                  <Input
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t("admin.production.logs.inputVolume")} (L)</Label>
                  <Input
                    type="number"
                    step="0.001"
                    value={formData.input_volume}
                    onChange={(e) => setFormData({ ...formData, input_volume: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.production.logs.inputConcentration")} (%)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={formData.input_concentration}
                    onChange={(e) =>
                      setFormData({ ...formData, input_concentration: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.production.logs.outputVolume")} (L)</Label>
                  <Input
                    type="number"
                    step="0.001"
                    value={formData.output_volume}
                    onChange={(e) => setFormData({ ...formData, output_volume: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.production.logs.outputConcentration")} (%)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={formData.output_concentration}
                    onChange={(e) =>
                      setFormData({ ...formData, output_concentration: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.production.logs.lossVolume")} (L)</Label>
                  <Input
                    type="number"
                    step="0.001"
                    value={formData.loss_volume}
                    onChange={(e) => setFormData({ ...formData, loss_volume: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.production.logs.wasteVolume")} (L)</Label>
                  <Input
                    type="number"
                    step="0.001"
                    value={formData.waste_volume}
                    onChange={(e) => setFormData({ ...formData, waste_volume: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.production.logs.sourceContainer")}</Label>
                  <Input
                    value={formData.source_container}
                    onChange={(e) => setFormData({ ...formData, source_container: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.production.logs.targetContainer")}</Label>
                  <Input
                    value={formData.target_container}
                    onChange={(e) => setFormData({ ...formData, target_container: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.production.logs.temperature")} (°C)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={formData.temperature}
                    onChange={(e) => setFormData({ ...formData, temperature: e.target.value })}
                  />
                </div>
                <div className="col-span-2 space-y-2">
                  <Label>{t("admin.production.logs.notes")}</Label>
                  <Textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={createLogMutation.isPending || !formData.title}
                >
                  {t("common.save")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder={t("admin.production.logs.filterCategory")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common.all")}</SelectItem>
                  {LOG_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`admin.production.logs.categories.${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder={t("admin.production.logs.filterType")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("common.all")}</SelectItem>
                {LOG_TYPES.map((logType) => (
                  <SelectItem key={logType} value={logType}>
                    {logType}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Logs Table */}
      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="h-32 flex items-center justify-center text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.production.logs.date")}</TableHead>
                  <TableHead>{t("admin.production.logs.batch")}</TableHead>
                  <TableHead>{t("admin.production.logs.category")}</TableHead>
                  <TableHead>{t("admin.production.logs.title")}</TableHead>
                  <TableHead>{t("admin.production.logs.input")}</TableHead>
                  <TableHead>{t("admin.production.logs.output")}</TableHead>
                  <TableHead>{t("admin.production.logs.loss")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs?.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm">
                      {new Date(log.performed_at).toLocaleDateString()}
                      <br />
                      <span className="text-muted-foreground">
                        {new Date(log.performed_at).toLocaleTimeString()}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{log.batch_code || "-"}</TableCell>
                    <TableCell>
                      <Badge
                        className={`${getCategoryColor(log.log_category)} flex items-center gap-1 w-fit`}
                      >
                        {getCategoryIcon(log.log_category)}
                        {t(`admin.production.logs.categories.${log.log_category}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div>{log.title}</div>
                      <div className="text-xs text-muted-foreground">{log.log_type}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {log.input_volume ? `${log.input_volume}L` : "-"}
                      {log.input_concentration && (
                        <span className="text-muted-foreground"> @ {log.input_concentration}%</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {log.output_volume ? `${log.output_volume}L` : "-"}
                      {log.output_concentration && (
                        <span className="text-muted-foreground">
                          {" "}
                          @ {log.output_concentration}%
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {log.loss_volume ? (
                        <span className="text-destructive">{log.loss_volume}L</span>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
