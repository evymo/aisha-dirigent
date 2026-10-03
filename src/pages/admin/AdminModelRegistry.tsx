/**
 * Admin page for managing the AI Model Registry.
 * Browse, approve, reject, and configure LLM models.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Cpu, Check, X, RefreshCw, Eye, EyeOff, DownloadCloud, RotateCcw, Gauge } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import {
  useModelRegistry,
  useApproveModel,
  useRejectModel,
  useUpdateModelRegistry,
  useDiscoverModels,
  useBenchmarkModels,
  type ModelRegistryRow,
} from "@/hooks/useModelRegistry";

/** Maps eval_status to badge color. */
function evalBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "approved": return "default";
    case "rejected": return "destructive";
    case "pending": return "secondary";
    default: return "outline";
  }
}

/** Formats price as $/M tokens or "N/A". */
function formatPrice(price: number | null): string {
  if (price == null) return "N/A";
  return `$${price.toFixed(2)}`;
}

export default function AdminModelRegistry() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("view_admin_dashboard");

  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showUnavailable, setShowUnavailable] = useState(false);

  const { data: models, isLoading, refetch } = useModelRegistry({
    provider: providerFilter === "all" ? undefined : providerFilter,
    evalStatus: statusFilter === "all" ? undefined : statusFilter,
    availableOnly: !showUnavailable,
  });

  const approveModel = useApproveModel();
  const rejectModel = useRejectModel();
  const updateModel = useUpdateModelRegistry();
  const discoverModels = useDiscoverModels();
  const benchmarkModels = useBenchmarkModels();

  const handleBenchmark = async () => {
    try {
      const r = await benchmarkModels.mutateAsync({});
      toast.success(t("admin.modelRegistry.benchmarkDone", { models: r.modelsBenchmarked }));
    } catch {
      toast.error(t("common.error"));
    }
  };

  const handleDiscover = async () => {
    try {
      const r = await discoverModels.mutateAsync({});
      toast.success(t("admin.modelRegistry.discoverDone", { discovered: r.discovered, tested: r.tested }));
    } catch {
      toast.error(t("common.error"));
    }
  };

  const handleRetestRejected = async () => {
    try {
      const r = await discoverModels.mutateAsync({ mode: "rejected-only" });
      toast.success(t("admin.modelRegistry.retestDone", { tested: r.tested }));
    } catch {
      toast.error(t("common.error"));
    }
  };

  const handleApprove = async (model: ModelRegistryRow) => {
    try {
      await approveModel.mutateAsync(model.id);
      toast.success(t("admin.modelRegistry.approved", { model: model.model_id }));
    } catch {
      toast.error(t("common.error"));
    }
  };

  const handleReject = async (model: ModelRegistryRow) => {
    try {
      await rejectModel.mutateAsync({ modelRegistryId: model.id });
      toast.success(t("admin.modelRegistry.rejected", { model: model.model_id }));
    } catch {
      toast.error(t("common.error"));
    }
  };

  const handleToggleAvailability = async (model: ModelRegistryRow) => {
    try {
      await updateModel.mutateAsync({
        modelRegistryId: model.id,
        isAvailable: !model.is_available,
      });
      toast.success(
        model.is_available
          ? t("admin.modelRegistry.disabled", { model: model.model_id })
          : t("admin.modelRegistry.enabled", { model: model.model_id }),
      );
    } catch {
      toast.error(t("common.error"));
    }
  };

  const handleToggleDeprecated = async (model: ModelRegistryRow) => {
    try {
      await updateModel.mutateAsync({
        modelRegistryId: model.id,
        isDeprecated: !model.is_deprecated,
      });
      toast.success(t("admin.modelRegistry.updated"));
    } catch {
      toast.error(t("common.error"));
    }
  };

  // Derive unique providers from data
  const providers = Array.from(new Set((models ?? []).map((m) => m.provider))).sort();

  // Summary stats
  const total = models?.length ?? 0;
  const approved = models?.filter((m) => m.eval_status === "approved").length ?? 0;
  const pending = models?.filter((m) => m.eval_status === "pending").length ?? 0;
  const rejected = models?.filter((m) => m.eval_status === "rejected").length ?? 0;

  if (!canManage) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>{t("common.permissionDenied")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Cpu className="h-8 w-8" />
            {t("admin.modelRegistry.title")}
          </h1>
          <p className="text-muted-foreground mt-2">
            {t("admin.modelRegistry.description")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleDiscover}
            disabled={!canManage || discoverModels.isPending}
            size="sm"
          >
            <DownloadCloud className={`h-4 w-4 mr-2 ${discoverModels.isPending ? "animate-pulse" : ""}`} />
            {t("admin.modelRegistry.fetchModels")}
          </Button>
          {rejected > 0 && (
            <Button
              onClick={handleRetestRejected}
              disabled={!canManage || discoverModels.isPending}
              variant="outline"
              size="sm"
            >
              <RotateCcw className={`h-4 w-4 mr-2 ${discoverModels.isPending ? "animate-spin" : ""}`} />
              {t("admin.modelRegistry.retestRejected")}
            </Button>
          )}
          <Button
            onClick={handleBenchmark}
            disabled={!canManage || benchmarkModels.isPending}
            variant="outline"
            size="sm"
          >
            <Gauge className={`h-4 w-4 mr-2 ${benchmarkModels.isPending ? "animate-pulse" : ""}`} />
            {t("admin.modelRegistry.benchmark")}
          </Button>
          <Button onClick={() => refetch()} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.modelRegistry.totalModels")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.modelRegistry.approvedModels")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{approved}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.modelRegistry.pendingModels")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{pending}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("admin.modelRegistry.rejectedModels")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{rejected}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.modelRegistry.filters")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label>{t("admin.modelRegistry.provider")}</Label>
              <Select value={providerFilter} onValueChange={setProviderFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("admin.modelRegistry.allProviders")}</SelectItem>
                  {providers.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("admin.modelRegistry.status")}</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("admin.modelRegistry.allStatuses")}</SelectItem>
                  <SelectItem value="pending">{t("admin.modelRegistry.statusPending")}</SelectItem>
                  <SelectItem value="approved">{t("admin.modelRegistry.statusApproved")}</SelectItem>
                  <SelectItem value="rejected">{t("admin.modelRegistry.statusRejected")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={showUnavailable}
                onCheckedChange={setShowUnavailable}
                id="show-unavailable"
              />
              <Label htmlFor="show-unavailable">{t("admin.modelRegistry.showUnavailable")}</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Model List */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.modelRegistry.modelList")}</CardTitle>
          <CardDescription>
            {total} {t("admin.modelRegistry.modelsFound")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {models && models.length > 0 ? (
            <div className="space-y-3">
              {models.map((model) => (
                <div
                  key={model.id}
                  className="border rounded-lg p-4 space-y-3"
                >
                  {/* Row 1: ID + badges */}
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-sm">
                        {model.model_id}
                      </span>
                      <Badge variant="outline">{model.provider}</Badge>
                      <Badge variant={evalBadgeVariant(model.eval_status)}>
                        {model.eval_status}
                      </Badge>
                      {model.is_deprecated && (
                        <Badge variant="destructive">{t("admin.modelRegistry.deprecated")}</Badge>
                      )}
                      {!model.is_available && (
                        <Badge variant="secondary">{t("admin.modelRegistry.unavailable")}</Badge>
                      )}
                    </div>
                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      {model.eval_status === "pending" && (
                        <>
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => handleApprove(model)}
                            disabled={approveModel.isPending}
                          >
                            <Check className="h-4 w-4 mr-1" />
                            {t("admin.modelRegistry.approve")}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleReject(model)}
                            disabled={rejectModel.isPending}
                          >
                            <X className="h-4 w-4 mr-1" />
                            {t("admin.modelRegistry.reject")}
                          </Button>
                        </>
                      )}
                      {model.eval_status === "rejected" && (
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => handleApprove(model)}
                          disabled={approveModel.isPending}
                        >
                          <Check className="h-4 w-4 mr-1" />
                          {t("admin.modelRegistry.approve")}
                        </Button>
                      )}
                      {model.eval_status === "approved" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleReject(model)}
                          disabled={rejectModel.isPending}
                        >
                          <X className="h-4 w-4 mr-1" />
                          {t("admin.modelRegistry.revoke")}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleToggleAvailability(model)}
                        disabled={updateModel.isPending}
                        title={model.is_available ? t("admin.modelRegistry.disable") : t("admin.modelRegistry.enable")}
                      >
                        {model.is_available ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  {/* Row 2: Details */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm text-muted-foreground">
                    <div>
                      <span className="font-medium">{t("admin.modelRegistry.contextWindow")}:</span>{" "}
                      {model.context_window ? `${(model.context_window / 1000).toFixed(0)}K` : "N/A"}
                    </div>
                    <div>
                      <span className="font-medium">{t("admin.modelRegistry.inputPrice")}:</span>{" "}
                      {formatPrice(model.input_price_per_m)}{t("admin.modelRegistry.perMillion")}
                    </div>
                    <div>
                      <span className="font-medium">{t("admin.modelRegistry.outputPrice")}:</span>{" "}
                      {formatPrice(model.output_price_per_m)}{t("admin.modelRegistry.perMillion")}
                    </div>
                    <div>
                      <span className="font-medium">{t("admin.modelRegistry.cachedPrice")}:</span>{" "}
                      {formatPrice(model.cached_input_price_per_m)}{t("admin.modelRegistry.perMillion")}
                    </div>
                    <div>
                      <span className="font-medium">{t("admin.modelRegistry.evalScore")}:</span>{" "}
                      {model.latest_eval_score != null ? model.latest_eval_score.toFixed(2) : "N/A"}
                    </div>
                  </div>

                  {/* Row 3: Capabilities */}
                  <div className="flex flex-wrap gap-1">
                    {model.is_reasoning && (
                      <Badge variant="outline" className="text-xs">{t("admin.modelRegistry.capReasoning")}</Badge>
                    )}
                    {model.is_vision && (
                      <Badge variant="outline" className="text-xs">{t("admin.modelRegistry.capVision")}</Badge>
                    )}
                    {model.is_function_calling && (
                      <Badge variant="outline" className="text-xs">{t("admin.modelRegistry.capFunctionCalling")}</Badge>
                    )}
                    {model.best_task_type && (
                      <Badge variant="outline" className="text-xs">
                        {t("admin.modelRegistry.bestAt")}: {model.best_task_type}
                        {model.best_task_score != null && ` (${model.best_task_score.toFixed(2)})`}
                      </Badge>
                    )}
                  </div>

                  {/* Row 4: Timestamps */}
                  <div className="text-xs text-muted-foreground flex gap-4">
                    <span>{t("admin.modelRegistry.firstSeen")}: {new Date(model.first_seen_at).toLocaleDateString()}</span>
                    <span>{t("admin.modelRegistry.lastSeen")}: {new Date(model.last_seen_at).toLocaleDateString()}</span>
                    {model.is_deprecated && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs"
                        onClick={() => handleToggleDeprecated(model)}
                        disabled={updateModel.isPending}
                      >
                        {t("admin.modelRegistry.undeprecate")}
                      </Button>
                    )}
                    {!model.is_deprecated && model.eval_status === "approved" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs text-destructive"
                        onClick={() => handleToggleDeprecated(model)}
                        disabled={updateModel.isPending}
                      >
                        {t("admin.modelRegistry.markDeprecated")}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("admin.modelRegistry.noModels")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
