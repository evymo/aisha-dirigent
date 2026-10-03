import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DataTable } from "@/components/ui/data-table/DataTable";
import { getForecastColumns } from "./distribution-forecast-columns";
import { useCurrency } from "@/hooks/useCurrency";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useDistributionForecastsAdmin,
  useStudiesForForecast,
  useRecalculateForecast,
  useUpdateForecastStatus,
} from "@/hooks/useAdminDistributionForecast";
import {
  Package,
  TrendingUp,
  Calendar,
  Loader2,
  RefreshCw,
  BarChart3,
  AlertTriangle,
  ArrowRight,
  Clock
} from "lucide-react";
import { toast } from "sonner";

const PRODUCTION_STATUSES = ['planning', 'reserved', 'in_production', 'ready', 'distributed'];

const STATUS_COLORS: Record<string, string> = {
  planning: 'bg-gray-100 text-gray-800',
  reserved: 'bg-blue-100 text-blue-800',
  in_production: 'bg-yellow-100 text-yellow-800',
  ready: 'bg-green-100 text-green-800',
  distributed: 'bg-purple-100 text-purple-800',
};

export default function AdminDistributionForecast() {
  const { t } = useTranslation();
  const { formatCurrency } = useCurrency();

  // Filter state
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [selectedStudy, setSelectedStudy] = useState<string>('all');

  const { data: forecastData, isLoading: loading, refetch } = useDistributionForecastsAdmin(selectedMonth, selectedStudy);
  const { data: studies = [] } = useStudiesForForecast();
  const recalculateMutation = useRecalculateForecast();
  const updateStatusMutation = useUpdateForecastStatus();

  const forecasts = forecastData?.forecasts ?? [];
  const monthlyStats = forecastData?.stats ?? {
    total_packages: 0,
    total_value: 0,
    total_members: 0,
    vip_members: 0,
  };

  const recalculateForecast = async () => {
    try {
      await recalculateMutation.mutateAsync({ month: selectedMonth, studyId: selectedStudy });
      toast.success(t("admin.distributionForecast.recalculateSuccess"));
    } catch {
      toast.error(t("admin.distributionForecast.recalculateError"));
    }
  };

  const updateProductionStatus = async (forecastId: string, newStatus: string) => {
    try {
      await updateStatusMutation.mutateAsync({ forecastId, status: newStatus });
      toast.success(t("admin.distributionForecast.statusUpdated"));
    } catch {
      toast.error(t("admin.distributionForecast.statusUpdateError"));
    }
  };

  // Generate month options (6 months back, 12 months forward)
  const monthOptions = Array.from({ length: 18 }, (_, i) => {
    const now = new Date();
    const targetMonth = now.getMonth() - 6 + i;
    const date = new Date(now.getFullYear(), targetMonth, 1);
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const label = date.toLocaleDateString('cs-CZ', { year: 'numeric', month: 'long' });
    return { value, label };
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable callback
  const columns = useMemo(() => getForecastColumns(t, updateProductionStatus, formatCurrency), [t, formatCurrency]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("admin.distributionForecast.title")}</h1>
          <p className="text-muted-foreground">{t("admin.distributionForecast.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            {t("common.refresh")}
          </Button>
          <Button onClick={recalculateForecast} disabled={recalculateMutation.isPending}>
            {recalculateMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t("admin.distributionForecast.recalculating")}</>
            ) : (
              <><BarChart3 className="h-4 w-4 mr-2" />{t("admin.distributionForecast.recalculate")}</>
            )}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">{t("admin.distributionForecast.filters")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="space-y-2 min-w-[200px]">
              <Label>{t("admin.distributionForecast.month")}</Label>
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 min-w-[200px]">
              <Label>{t("admin.distributionForecast.study")}</Label>
              <Select value={selectedStudy} onValueChange={setSelectedStudy}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("admin.distributionForecast.allStudies")}</SelectItem>
                  {studies.map((study) => (
                    <SelectItem key={study.id} value={study.id}>
                      {study.name} ({study.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Package className="h-4 w-4" />
              {t("admin.distributionForecast.stats.totalPackages")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{monthlyStats.total_packages.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              {t("admin.distributionForecast.stats.toDistribute")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              {t("admin.distributionForecast.stats.compensatedValue")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(monthlyStats.total_value)}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("admin.distributionForecast.stats.vipCost")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              {t("admin.distributionForecast.stats.totalMembers")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{monthlyStats.total_members}</div>
            <p className="text-xs text-muted-foreground">
              {monthlyStats.vip_members} {t("admin.distributionForecast.stats.vipMembers")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              {t("admin.distributionForecast.stats.productionStatus")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1">
              {forecasts.length > 0 ? (
                <>
                  {['ready', 'in_production', 'planning'].map(status => {
                    const count = forecasts.filter(f => f.production_status === status).length;
                    if (count === 0) return null;
                    return (
                      <Badge key={status} className={STATUS_COLORS[status]}>
                        {count} {t(`admin.distributionForecast.status.${status}`)}
                      </Badge>
                    );
                  })}
                </>
              ) : (
                <span className="text-sm text-muted-foreground">{t("admin.distributionForecast.noData")}</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Forecast Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.distributionForecast.forecastList")}</CardTitle>
          <CardDescription>
            {t("admin.distributionForecast.forecastListDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : forecasts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <AlertTriangle className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{t("admin.distributionForecast.empty")}</p>
              <p className="text-sm mt-2">{t("admin.distributionForecast.emptyHint")}</p>
              <Button onClick={recalculateForecast} className="mt-4" variant="outline">
                <BarChart3 className="h-4 w-4 mr-2" />
                {t("admin.distributionForecast.generateForecast")}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <DataTable
                columns={columns}
                data={forecasts}
              />

              {/* Total Summary - Manually rendered below DataTable as it doesn't support footer aggregation easily yet */}
              <div className="border rounded-md p-4 bg-muted/50">
                <div className="flex items-center justify-between font-bold text-sm">
                  <div className="flex items-center gap-2">
                    <ArrowRight className="h-4 w-4" />
                    {t("admin.distributionForecast.total")}
                  </div>
                  <div className="grid grid-cols-4 gap-4 text-right flex-1 ml-4 pl-4 border-l"> {/* Approximate alignment */}
                    <div className="text-center">{monthlyStats.total_members}</div>
                    <div className="text-center">{monthlyStats.vip_members}</div>
                    <div className="text-center text-lg">{monthlyStats.total_packages}</div>
                    <div className="text-right text-green-600">
                      {formatCurrency(monthlyStats.total_value)}
                    </div>
                  </div>
                  <div className="w-[150px]"></div> {/* Spacer for status column */}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Production Workflow Info */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.distributionForecast.workflow.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between flex-wrap gap-4">
            {PRODUCTION_STATUSES.map((status, index) => (
              <div key={status} className="flex items-center gap-2">
                <Badge className={`${STATUS_COLORS[status]} min-w-[100px] justify-center`}>
                  {t(`admin.distributionForecast.status.${status}`)}
                </Badge>
                {index < PRODUCTION_STATUSES.length - 1 && (
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground mt-4">
            {t("admin.distributionForecast.workflow.description")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
