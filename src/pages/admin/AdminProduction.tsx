import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Plus, Pencil, Package, Factory, FlaskConical, CheckCircle, Clock, AlertTriangle, Eye, Link as LinkIcon, Boxes, XCircle, GitBranch, FileText, ClipboardList, Layers, Droplets } from "lucide-react";
import type { Tables, Enums } from "@/integrations/db/types";
import {
  useProductionBatchesAdmin,
  useProductionProductsAdmin,
  useProductionStudiesAdmin,
  useBatchWorkflowStepsAdmin,
  useBatchMilestonesAdmin,
  useBatchVialsAdmin,
  useCreateProductionBatchMutation,
  useUpdateProductionBatchMutation,
  useUpdateBatchStatusMutation,
  type BatchFormData,
  type ProductionBatchWithRelations,
} from "@/hooks";
import { WorkflowDesigner } from "@/components/production/WorkflowDesigner";
import ProductionLogs from "@/components/production/ProductionLogs";
import LabelTemplates from "@/components/production/LabelTemplates";
import ProductWorkflowManager from "@/components/production/ProductWorkflowManager";
import BatchProtocolSteps from "@/components/production/BatchProtocolSteps";
import FlowTracking from "@/components/production/flow/FlowTracking";

type ProductionBatch = Tables<"production_batches">;
type BatchStatus = Enums<"batch_status">;
type VialContentType = Enums<"vial_content_type">;
type BatchPurpose = "study" | "retail" | "sample" | "internal_testing";

const defaultFormData: BatchFormData = {
  batch_code: "",
  product_name: "",
  product_id: null,
  study_id: null,
  purpose: "retail",
  target_quantity: 100,
  unit: "vials",
  raw_material_lot: "",
  expiry_date: "",
  content_type: null,
};

export default function AdminProduction() {
  const { t } = useTranslation();
  const { data: batches, isLoading } = useProductionBatchesAdmin();
  const { data: products } = useProductionProductsAdmin();
  const { data: studies } = useProductionStudiesAdmin();
  
  const createBatchMutationHook = useCreateProductionBatchMutation();
  const updateBatchMutationHook = useUpdateProductionBatchMutation();
  const updateStatusMutationHook = useUpdateBatchStatusMutation();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingBatch, setEditingBatch] = useState<ProductionBatchWithRelations | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<ProductionBatchWithRelations | null>(null);
  const [formData, setFormData] = useState<BatchFormData>(defaultFormData);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const createBatchMutation = {
    mutate: (data: BatchFormData) => {
      createBatchMutationHook.mutate(data, {
        onSuccess: () => {
          setIsCreateOpen(false);
          setFormData(defaultFormData);
          toast.success(t("admin.production.batchCreated"));
        },
        onError: () => toast.error(t("admin.production.errors.createFailed")),
      });
    },
    isPending: createBatchMutationHook.isPending,
  };

  const updateBatchMutation = {
    mutate: ({ id, data }: { id: string; data: Partial<ProductionBatch> }) => {
      updateBatchMutationHook.mutate({ id, data }, {
        onSuccess: () => {
          setEditingBatch(null);
          setFormData(defaultFormData);
          toast.success(t("admin.production.batchUpdated"));
        },
        onError: () => toast.error(t("admin.production.errors.updateFailed")),
      });
    },
    isPending: updateBatchMutationHook.isPending,
  };

  const updateStatusMutation = {
    mutate: ({ id, status }: { id: string; status: BatchStatus }) => {
      updateStatusMutationHook.mutate({ id, status }, {
        onSuccess: () => toast.success(t("admin.production.statusUpdated")),
        onError: () => toast.error(t("admin.production.errors.statusUpdateFailed")),
      });
    },
    isPending: updateStatusMutationHook.isPending,
  };

  const filteredBatches = batches?.filter((batch) =>
    statusFilter === "all" || batch.status === statusFilter
  ) ?? [];

  const getStatusBadge = (status: BatchStatus) => {
    const config: Record<BatchStatus, { variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
      draft: { variant: "outline", icon: <Clock className="w-3 h-3" /> },
      in_production: { variant: "default", icon: <Factory className="w-3 h-3" /> },
      qc_pending: { variant: "secondary", icon: <FlaskConical className="w-3 h-3" /> },
      qc_passed: { variant: "default", icon: <CheckCircle className="w-3 h-3" /> },
      qc_failed: { variant: "destructive", icon: <XCircle className="w-3 h-3" /> },
      released: { variant: "secondary", icon: <Package className="w-3 h-3" /> },
      quarantined: { variant: "destructive", icon: <AlertTriangle className="w-3 h-3" /> },
      recalled: { variant: "destructive", icon: <AlertTriangle className="w-3 h-3" /> },
      expired: { variant: "outline", icon: <Clock className="w-3 h-3" /> },
    };
    const { variant, icon } = config[status] || { variant: "outline", icon: null };
    return (
      <Badge variant={variant} className="flex items-center gap-1">
        {icon}
        {t(`admin.production.status.${status}`)}
      </Badge>
    );
  };

  const handleEdit = (batch: ProductionBatchWithRelations) => {
    setEditingBatch(batch);
    setFormData({
      batch_code: batch.batch_code ?? "",
      product_name: batch.product?.name ?? "",
      product_id: batch.product_id,
      study_id: batch.study_id,
      purpose: (batch.purpose as BatchPurpose) ?? "retail",
      target_quantity: batch.target_quantity ?? 0,
      unit: batch.unit || "vials",
      raw_material_lot: batch.raw_material_lot || "",
      expiry_date: batch.expiry_date ? batch.expiry_date.split("T")[0] : "",
      content_type: batch.content_type as VialContentType | null,
    });
  };

  const stats = {
    total: batches?.length || 0,
    inProduction: batches?.filter((b) => b.status === "in_production").length || 0,
    qcPending: batches?.filter((b) => b.status === "qc_pending").length || 0,
    released: batches?.filter((b) => b.status === "released").length || 0,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold">{t("admin.production.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("admin.production.subtitle")}</p>
      </div>

      <Tabs defaultValue="batches">
        <TabsList>
          <TabsTrigger value="batches" className="flex items-center gap-2">
            <Boxes className="w-4 h-4" />
            {t("admin.production.tabs.batches")}
          </TabsTrigger>
          <TabsTrigger value="workflow" className="flex items-center gap-2">
            <GitBranch className="w-4 h-4" />
            {t("admin.production.tabs.workflowDesigner")}
          </TabsTrigger>
          <TabsTrigger value="productWorkflows" className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            {t("admin.production.workflow.productTemplates")}
          </TabsTrigger>
          <TabsTrigger value="logs" className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4" />
            {t("admin.production.tabs.logs")}
          </TabsTrigger>
          <TabsTrigger value="labels" className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            {t("admin.production.tabs.labels")}
          </TabsTrigger>
          <TabsTrigger value="flowTracking" className="flex items-center gap-2">
            <Droplets className="w-4 h-4" />
            {t("admin.production.tabs.flowTracking")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="batches" className="mt-6 space-y-6">
          <div className="flex justify-end">
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => setFormData(defaultFormData)}>
                  <Plus className="w-4 h-4 mr-2" />
                  {t("admin.production.createBatch")}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>{t("admin.production.createBatch")}</DialogTitle>
                  <DialogDescription>{t("admin.production.createDescription")}</DialogDescription>
                </DialogHeader>
                <BatchForm
                  formData={formData}
                  setFormData={setFormData}
                  products={products || []}
                  studies={studies || []}
                />
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)}>{t("common.cancel")}</Button>
                  <Button onClick={() => createBatchMutation.mutate(formData)} disabled={createBatchMutation.isPending}>
                    {createBatchMutation.isPending ? t("common.saving") : t("admin.production.create")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Boxes className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("admin.production.totalBatches")}</p>
                    <p className="text-2xl font-semibold">{stats.total}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-secondary/10">
                    <Factory className="w-5 h-5 text-secondary-foreground" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("admin.production.inProduction")}</p>
                    <p className="text-2xl font-semibold">{stats.inProduction}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-accent/10">
                    <FlaskConical className="w-5 h-5 text-accent-foreground" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("admin.production.qcPending")}</p>
                    <p className="text-2xl font-semibold">{stats.qcPending}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <CheckCircle className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("admin.production.released")}</p>
                    <p className="text-2xl font-semibold">{stats.released}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Batches List */}
          <Card>
            <CardHeader>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <CardTitle>{t("admin.production.allBatches")}</CardTitle>
                  <CardDescription>{filteredBatches.length} {t("admin.production.batchesCount")}</CardDescription>
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder={t("admin.production.filterStatus")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("common.all")}</SelectItem>
                    <SelectItem value="draft">{t("admin.production.status.draft")}</SelectItem>
                    <SelectItem value="in_production">{t("admin.production.status.in_production")}</SelectItem>
                    <SelectItem value="qc_pending">{t("admin.production.status.qc_pending")}</SelectItem>
                    <SelectItem value="qc_passed">{t("admin.production.status.qc_passed")}</SelectItem>
                    <SelectItem value="qc_failed">{t("admin.production.status.qc_failed")}</SelectItem>
                    <SelectItem value="released">{t("admin.production.status.released")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-32 flex items-center justify-center text-muted-foreground">{t("common.loading")}</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("admin.production.table.batchCode")}</TableHead>
                      <TableHead>{t("admin.production.table.product")}</TableHead>
                      <TableHead>{t("admin.production.table.purpose")}</TableHead>
                      <TableHead>{t("admin.production.table.quantity")}</TableHead>
                      <TableHead>{t("admin.production.table.status")}</TableHead>
                      <TableHead>{t("admin.production.table.blockchain")}</TableHead>
                      <TableHead>{t("admin.production.table.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredBatches.map((batch) => (
                      <TableRow key={batch.id}>
                        <TableCell className="font-mono font-medium">{batch.batch_code}</TableCell>
                        <TableCell>
                          <div>
                            <div>{batch.product?.name}</div>
                            {batch.study && (
                              <div className="text-xs text-muted-foreground">{batch.study.code}</div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{batch.purpose}</Badge>
                        </TableCell>
                        <TableCell>
                          {batch.actual_quantity || batch.target_quantity} {batch.unit}
                        </TableCell>
                        <TableCell>{getStatusBadge(batch.status as BatchStatus)}</TableCell>
                        <TableCell>
                          {batch.blockchain_tx_hash ? (
                            <Badge variant="secondary" className="flex items-center gap-1 w-fit">
                              <LinkIcon className="w-3 h-3" />
                              {t("admin.production.recorded")}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" onClick={() => setSelectedBatch(batch)}>
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleEdit(batch)}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Edit Dialog */}
          <Dialog open={!!editingBatch} onOpenChange={(open) => !open && setEditingBatch(null)}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{t("admin.production.editBatch")}</DialogTitle>
              </DialogHeader>
              <BatchForm
                formData={formData}
                setFormData={setFormData}
                products={products || []}
                studies={studies || []}
              />
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditingBatch(null)}>{t("common.cancel")}</Button>
                <Button
                  onClick={() => editingBatch && updateBatchMutation.mutate({ id: editingBatch.id, data: formData })}
                  disabled={updateBatchMutation.isPending}
                >
                  {t("common.save")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Detail Dialog */}
          <Dialog open={!!selectedBatch} onOpenChange={(open) => !open && setSelectedBatch(null)}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{selectedBatch?.batch_code}</DialogTitle>
                <DialogDescription>{selectedBatch?.product?.name}</DialogDescription>
              </DialogHeader>
              {selectedBatch && (
                <BatchDetailView
                  batch={selectedBatch}
                  onStatusChange={(status) => {
                    updateStatusMutation.mutate({ id: selectedBatch.id, status });
                  }}
                />
              )}
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="workflow" className="mt-6">
          <WorkflowDesigner />
        </TabsContent>

        <TabsContent value="productWorkflows" className="mt-6">
          <ProductWorkflowManager />
        </TabsContent>

        <TabsContent value="logs" className="mt-6">
          <ProductionLogs />
        </TabsContent>

        <TabsContent value="labels" className="mt-6">
          <LabelTemplates />
        </TabsContent>

        <TabsContent value="flowTracking" className="mt-6">
          <FlowTracking />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BatchForm({
  formData,
  setFormData,
  products,
  studies
}: {
  formData: BatchFormData;
  setFormData: (data: BatchFormData) => void;
  products: { id: string; name: string }[];
  studies: { id: string; name: string; code: string }[];
}) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label>{t("admin.production.form.batchCode")} *</Label>
        <Input
          value={formData.batch_code}
          onChange={(e) => setFormData({ ...formData, batch_code: e.target.value })}
          placeholder={t("admin.production.form.batchCodePlaceholder")}
        />
      </div>
      <div className="space-y-2">
        <Label>{t("admin.production.form.productName")} *</Label>
        <Input
          value={formData.product_name}
          onChange={(e) => setFormData({ ...formData, product_name: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label>{t("admin.production.form.product")}</Label>
        <Select
          value={formData.product_id || "none"}
          onValueChange={(v) => setFormData({ ...formData, product_id: v === "none" ? null : v })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("common.none")}</SelectItem>
            {products.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>{t("admin.production.form.purpose")} *</Label>
        <Select
          value={formData.purpose}
          onValueChange={(v) => setFormData({ ...formData, purpose: v as BatchPurpose })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="retail">{t("admin.production.purpose.retail")}</SelectItem>
            <SelectItem value="study">{t("admin.production.purpose.study")}</SelectItem>
            <SelectItem value="sample">{t("admin.production.purpose.sample")}</SelectItem>
            <SelectItem value="internal_testing">{t("admin.production.purpose.internal_testing")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {formData.purpose === "study" && (
        <>
          <div className="space-y-2">
            <Label>{t("admin.production.form.study")}</Label>
            <Select
              value={formData.study_id || "none"}
              onValueChange={(v) => setFormData({ ...formData, study_id: v === "none" ? null : v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("common.none")}</SelectItem>
                {studies.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.code} - {s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("admin.production.form.contentType")}</Label>
            <Select
              value={formData.content_type || "none"}
              onValueChange={(v) => setFormData({ ...formData, content_type: v === "none" ? null : v as VialContentType })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("common.none")}</SelectItem>
                <SelectItem value="active">{t("admin.production.contentTypes.active")}</SelectItem>
                <SelectItem value="placebo">{t("admin.production.contentTypes.placebo")}</SelectItem>
                <SelectItem value="comparator">{t("admin.production.contentTypes.comparator")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}
      <div className="space-y-2">
        <Label>{t("admin.production.form.targetQuantity")} *</Label>
        <Input
          type="number"
          value={formData.target_quantity}
          onChange={(e) => setFormData({ ...formData, target_quantity: parseInt(e.target.value) || 0 })}
        />
      </div>
      <div className="space-y-2">
        <Label>{t("admin.production.form.unit")}</Label>
        <Input
          value={formData.unit}
          onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label>{t("admin.production.form.rawMaterialLot")}</Label>
        <Input
          value={formData.raw_material_lot}
          onChange={(e) => setFormData({ ...formData, raw_material_lot: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label>{t("admin.production.form.expiryDate")}</Label>
        <Input
          type="date"
          value={formData.expiry_date}
          onChange={(e) => setFormData({ ...formData, expiry_date: e.target.value })}
        />
      </div>
    </div>
  );
}

function BatchDetailView({
  batch,
  onStatusChange
}: {
  batch: ProductionBatchWithRelations;
  onStatusChange: (status: BatchStatus) => void;
}) {
  const { t } = useTranslation();
  const { data: workflow } = useBatchWorkflowStepsAdmin(batch.id);
  const { data: milestones } = useBatchMilestonesAdmin(batch.id);
  const { data: vials } = useBatchVialsAdmin(batch.id);

  const completedSteps = workflow?.filter((w) => w.status === "completed").length || 0;
  const totalSteps = workflow?.length || 0;
  const progress = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  const nextStatuses: Record<BatchStatus, BatchStatus[]> = {
    draft: ["in_production"],
    in_production: ["qc_pending", "qc_failed"],
    qc_pending: ["qc_passed", "qc_failed"],
    qc_passed: ["released"],
    qc_failed: ["draft", "quarantined"],
    released: [],
    quarantined: ["draft"],
    recalled: [],
    expired: [],
  };

  return (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">{t("admin.production.tabs.overview")}</TabsTrigger>
        <TabsTrigger value="protocol">{t("admin.production.protocol.progress")}</TabsTrigger>
        <TabsTrigger value="workflow">{t("admin.production.tabs.workflow")}</TabsTrigger>
        <TabsTrigger value="vials">{t("admin.production.tabs.vials")}</TabsTrigger>
        <TabsTrigger value="milestones">{t("admin.production.tabs.milestones")}</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-4 mt-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-muted-foreground">{t("admin.production.form.purpose")}</Label>
            <p className="font-medium">{batch.purpose}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">{t("admin.production.form.targetQuantity")}</Label>
            <p className="font-medium">{batch.target_quantity} {batch.unit}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">{t("admin.production.actualQuantity")}</Label>
            <p className="font-medium">{batch.actual_quantity || "-"} {batch.unit}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">{t("admin.production.form.expiryDate")}</Label>
            <p className="font-medium">{batch.expiry_date ? new Date(batch.expiry_date).toLocaleDateString() : "-"}</p>
          </div>
          {batch.blockchain_tx_hash && (
            <div className="col-span-2">
              <Label className="text-muted-foreground">{t("admin.production.blockchainTx")}</Label>
              <p className="font-mono text-sm break-all">{batch.blockchain_tx_hash}</p>
            </div>
          )}
        </div>

        <div className="pt-4">
          <Label className="text-muted-foreground">{t("admin.production.progress")}</Label>
          <Progress value={progress} className="mt-2" />
          <p className="text-sm text-muted-foreground mt-1">
            {completedSteps} / {totalSteps} {t("admin.production.stepsCompleted")}
          </p>
        </div>

        <div className="flex gap-2 pt-4">
          {batch.status && nextStatuses[batch.status as BatchStatus]?.map((status) => (
            <Button key={status} onClick={() => onStatusChange(status)} variant="outline">
              {t(`admin.production.action.${status}`)}
            </Button>
          ))}
        </div>
      </TabsContent>


      <TabsContent value="protocol" className="mt-4">
        <BatchProtocolSteps batchId={batch.id} batchCode={batch.batch_code || ''} />
      </TabsContent>

      <TabsContent value="workflow" className="mt-4">
        {workflow && workflow.length > 0 ? (
          <div className="space-y-3">
            {workflow.map((step, i) => (
              <div key={step.id} className="flex items-center gap-4 p-3 border rounded-lg">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${step.status === "completed" ? "bg-primary text-primary-foreground" :
                  step.status === "in_progress" ? "bg-secondary text-secondary-foreground" :
                    "bg-muted text-muted-foreground"
                  }`}>
                  {i + 1}
                </div>
                <div className="flex-1">
                  <p className="font-medium">{step.step_name}</p>
                  <p className="text-sm text-muted-foreground">{step.description}</p>
                </div>
                <Badge variant={
                  step.status === "completed" ? "default" :
                    step.status === "in_progress" ? "secondary" : "outline"
                }>
                  {step.status}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-center py-8">{t("admin.production.noWorkflow")}</p>
        )}
      </TabsContent>

      <TabsContent value="vials" className="mt-4">
        <div className="text-sm text-muted-foreground mb-4">
          {vials?.length || 0} {t("admin.production.vialsCreated")}
        </div>
        {vials && vials.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.production.vialCode")}</TableHead>
                <TableHead>{t("admin.production.contentType")}</TableHead>
                <TableHead>{t("admin.production.table.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vials.slice(0, 20).map((vial) => (
                <TableRow key={vial.id}>
                  <TableCell className="font-mono">{vial.vial_code}</TableCell>
                  <TableCell>{vial.content_type || "-"}</TableCell>
                  <TableCell><Badge variant="outline">{vial.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground text-center py-8">{t("admin.production.noVials")}</p>
        )}
      </TabsContent>

      <TabsContent value="milestones" className="mt-4">
        {milestones && milestones.length > 0 ? (
          <div className="space-y-3">
            {milestones.map((m) => (
              <div key={m.id} className="p-3 border rounded-lg">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium">{m.name}</p>
                    <p className="text-sm text-muted-foreground">{m.description}</p>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {m.achieved_at ? new Date(m.achieved_at).toLocaleDateString() : "-"}
                  </span>
                </div>
                {m.blockchain_tx_hash && (
                  <Badge variant="secondary" className="mt-2">
                    <LinkIcon className="w-3 h-3 mr-1" />
                    {t("admin.production.onChain")}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-center py-8">{t("admin.production.noMilestones")}</p>
        )}
      </TabsContent>
    </Tabs>
  );
}
