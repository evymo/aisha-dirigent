import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, Heart, Zap, Moon, TrendingDown, TrendingUp, Minus, Filter, X } from "lucide-react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { useAdminTrackingTrends, AGE_GROUPS } from "@/hooks/useAdminTrackingTrends";
import type { TrendDirection, RangePreset, TrendGranularity, CheckInTypeFilter } from "@/hooks/useAdminTrackingTrends";
import { useAdminStudiesOverview } from "@/hooks/useAdminStudies";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TrendIcon({ trend }: { trend: TrendDirection }) {
  if (trend === "up") return <TrendingUp className="w-4 h-4 text-secondary" />;
  if (trend === "down") return <TrendingDown className="w-4 h-4 text-destructive" />;
  return <Minus className="w-4 h-4 text-muted-foreground" />;
}

function TrendDelta({ delta, trend, t }: { delta: number | null; trend: TrendDirection; t: (key: string, opts?: Record<string, unknown>) => string }) {
  if (delta === null) return <span className="text-xs text-muted-foreground">{t("admin.outcomes.period.noChange")}</span>;
  const color = trend === "up" ? "text-secondary" : trend === "down" ? "text-destructive" : "text-muted-foreground";
  const label = delta > 0
    ? t("admin.outcomes.period.deltaUp", { value: delta.toFixed(1) })
    : delta < 0
    ? t("admin.outcomes.period.deltaDown", { value: delta.toFixed(1) })
    : t("admin.outcomes.period.noChange");
  return <span className={`text-xs ${color}`}>{label}</span>;
}

// ---------------------------------------------------------------------------
// Chart configs
// ---------------------------------------------------------------------------

const METRIC_COLORS = {
  pain: "hsl(0, 70%, 50%)",
  energy: "hsl(45, 80%, 50%)",
  sleep: "hsl(220, 70%, 50%)",
  mood: "hsl(150, 60%, 40%)",
  checkIns: "hsl(210, 70%, 35%)",
  uniqueUsers: "hsl(280, 50%, 55%)",
} as const;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AdminOutcomes() {
  const { t } = useTranslation();
  const {
    clearFilters,
    comparison,
    filters,
    granularity,
    hasActiveFilters,
    isLoading,
    periods,
    preset,
    setGranularity,
    setPreset,
    totals,
    updateFilter,
  } = useAdminTrackingTrends();

  const { data: studies } = useAdminStudiesOverview();

  // Chart configs (memoized on t)
  const metricsChartConfig = useMemo(
    () => ({
      energy: { label: t("admin.outcomes.chart.energy"), color: METRIC_COLORS.energy },
      mood: { label: t("admin.outcomes.chart.mood"), color: METRIC_COLORS.mood },
      pain: { label: t("admin.outcomes.chart.pain"), color: METRIC_COLORS.pain },
      sleep: { label: t("admin.outcomes.chart.sleep"), color: METRIC_COLORS.sleep },
    }),
    [t],
  );

  const engagementChartConfig = useMemo(
    () => ({
      checkIns: { label: t("admin.outcomes.chart.checkInsPerPeriod"), color: METRIC_COLORS.checkIns },
      uniqueUsers: { label: t("admin.outcomes.chart.uniqueUsers"), color: METRIC_COLORS.uniqueUsers },
    }),
    [t],
  );

  // Chart data transformation
  const chartData = useMemo(
    () =>
      periods.map((p) => ({
        avgEnergy: p.avgEnergy !== null ? +p.avgEnergy.toFixed(1) : null,
        avgMood: p.avgMood !== null ? +p.avgMood.toFixed(1) : null,
        avgPain: p.avgPain !== null ? +p.avgPain.toFixed(1) : null,
        avgSleep: p.avgSleep !== null ? +p.avgSleep.toFixed(1) : null,
        checkIns: p.checkInCount,
        period: p.periodStart,
        uniqueUsers: p.uniqueUsers,
      })),
    [periods],
  );

  const formatPeriodTick = (value: string) => {
    const d = new Date(value);
    if (granularity === "weekly") {
      return `${d.getDate()}.${d.getMonth() + 1}.`;
    }
    return `${d.getMonth() + 1}/${d.getFullYear()}`;
  };

  // ---- Loading ----
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">{t("admin.outcomes.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("admin.outcomes.subtitle")}</p>
        </div>
        <div className="h-64 flex items-center justify-center text-muted-foreground">
          {t("admin.outcomes.loading")}
        </div>
      </div>
    );
  }

  // ---- No data ----
  if (periods.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">{t("admin.outcomes.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("admin.outcomes.subtitle")}</p>
        </div>
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <Activity className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">{t("admin.outcomes.noData")}</p>
              <p className="text-sm mt-1">{t("admin.outcomes.noDataDescription")}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + controls */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">{t("admin.outcomes.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("admin.outcomes.subtitleFull")}</p>
        </div>
        <div className="flex gap-2">
          <Select value={granularity} onValueChange={(v) => setGranularity(v as TrendGranularity)}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder={t("admin.outcomes.period.granularity")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">{t("admin.outcomes.period.weekly")}</SelectItem>
              <SelectItem value="monthly">{t("admin.outcomes.period.monthly")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={preset} onValueChange={(v) => setPreset(v as RangePreset)}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder={t("admin.outcomes.period.range")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3m">{t("admin.outcomes.period.range3m")}</SelectItem>
              <SelectItem value="6m">{t("admin.outcomes.period.range6m")}</SelectItem>
              <SelectItem value="1y">{t("admin.outcomes.period.range1y")}</SelectItem>
              <SelectItem value="2y">{t("admin.outcomes.period.range2y")}</SelectItem>
              <SelectItem value="all">{t("admin.outcomes.period.rangeAll")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Filter panel */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">{t("admin.outcomes.filter.title")}</span>
                {hasActiveFilters && (
                  <Badge variant="secondary" className="text-xs">
                    {t("admin.outcomes.filter.activeCount", {
                      count: [filters.studyId, filters.ageMin !== null || filters.ageMax !== null ? "age" : null, filters.gender, filters.checkInType].filter(Boolean).length,
                    })}
                  </Badge>
                )}
              </div>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="h-7 text-xs gap-1">
                  <X className="w-3 h-3" />
                  {t("admin.outcomes.filter.clear")}
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {/* Study filter */}
              <Select
                value={filters.studyId ?? "__all__"}
                onValueChange={(v) => updateFilter("studyId", v === "__all__" ? null : v)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder={t("admin.outcomes.filter.study")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("admin.outcomes.filter.allStudies")}</SelectItem>
                  {studies?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Age group filter */}
              <Select
                value={
                  filters.ageMin !== null
                    ? AGE_GROUPS.find((g) => g.min === filters.ageMin && g.max === filters.ageMax)?.value ?? "__all__"
                    : "__all__"
                }
                onValueChange={(v) => {
                  if (v === "__all__") {
                    updateFilter("ageMin", null);
                    updateFilter("ageMax", null);
                  } else {
                    const group = AGE_GROUPS.find((g) => g.value === v);
                    if (group) {
                      updateFilter("ageMin", group.min);
                      updateFilter("ageMax", group.max);
                    }
                  }
                }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder={t("admin.outcomes.filter.ageGroup")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("admin.outcomes.filter.allAges")}</SelectItem>
                  {AGE_GROUPS.map((g) => (
                    <SelectItem key={g.value} value={g.value}>
                      {t(g.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Gender filter */}
              <Select
                value={filters.gender ?? "__all__"}
                onValueChange={(v) => updateFilter("gender", v === "__all__" ? null : v)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder={t("admin.outcomes.filter.gender")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("admin.outcomes.filter.allGenders")}</SelectItem>
                  <SelectItem value="male">{t("admin.outcomes.filter.genderMale")}</SelectItem>
                  <SelectItem value="female">{t("admin.outcomes.filter.genderFemale")}</SelectItem>
                  <SelectItem value="other">{t("admin.outcomes.filter.genderOther")}</SelectItem>
                </SelectContent>
              </Select>

              {/* Check-in type filter */}
              <Select
                value={filters.checkInType ?? "__all__"}
                onValueChange={(v) => updateFilter("checkInType", v === "__all__" ? null : v as CheckInTypeFilter)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder={t("admin.outcomes.filter.checkInType")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("admin.outcomes.filter.allTypes")}</SelectItem>
                  <SelectItem value="morning">{t("admin.outcomes.filter.typeMorning")}</SelectItem>
                  <SelectItem value="evening">{t("admin.outcomes.filter.typeEvening")}</SelectItem>
                  <SelectItem value="weekly">{t("admin.outcomes.filter.typeWeekly")}</SelectItem>
                  <SelectItem value="monthly">{t("admin.outcomes.filter.typeMonthly")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards with real trends */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Pain */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-destructive/10 shrink-0">
                  <Heart className="w-5 h-5 text-destructive" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground truncate">{t("admin.outcomes.stats.avgPain")}</p>
                  <p className="text-2xl font-semibold">{totals.avgPain.toFixed(1)}{t("common.scaleOutOfTen")}</p>
                  <TrendDelta delta={comparison.pain.delta} trend={comparison.pain.trend} t={t} />
                </div>
              </div>
              <TrendIcon trend={comparison.pain.trend} />
            </div>
          </CardContent>
        </Card>

        {/* Energy */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                  <Zap className="w-5 h-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground truncate">{t("admin.outcomes.stats.avgEnergy")}</p>
                  <p className="text-2xl font-semibold">{totals.avgEnergy.toFixed(1)}{t("common.scaleOutOfTen")}</p>
                  <TrendDelta delta={comparison.energy.delta} trend={comparison.energy.trend} t={t} />
                </div>
              </div>
              <TrendIcon trend={comparison.energy.trend} />
            </div>
          </CardContent>
        </Card>

        {/* Sleep */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-secondary/10 shrink-0">
                  <Moon className="w-5 h-5 text-secondary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground truncate">{t("admin.outcomes.stats.avgSleep")}</p>
                  <p className="text-2xl font-semibold">{totals.avgSleep.toFixed(1)}{t("common.scaleOutOfTen")}</p>
                  <TrendDelta delta={comparison.sleep.delta} trend={comparison.sleep.trend} t={t} />
                </div>
              </div>
              <TrendIcon trend={comparison.sleep.trend} />
            </div>
          </CardContent>
        </Card>

        {/* Mood */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-accent/10 shrink-0">
                  <Activity className="w-5 h-5 text-accent" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground truncate">{t("admin.outcomes.stats.avgMood")}</p>
                  <p className="text-2xl font-semibold">{totals.avgMood.toFixed(1)}{t("common.scaleOutOfTen")}</p>
                  <TrendDelta delta={comparison.mood.delta} trend={comparison.mood.trend} t={t} />
                </div>
              </div>
              <TrendIcon trend={comparison.mood.trend} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Metrics Over Time — multi-line chart */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.outcomes.chart.metricsOverTime")}</CardTitle>
          <CardDescription>
            {t("admin.outcomes.chart.metricsOverTimeSubtitle", {
              granularity: t(`admin.outcomes.period.${granularity}`).toLowerCase(),
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={metricsChartConfig} className="h-[350px] w-full">
            <LineChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="period" tick={{ fontSize: 10 }} tickFormatter={formatPeriodTick} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 10]} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={30} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Legend />
              <Line type="monotone" dataKey="avgPain" name={t("admin.outcomes.chart.pain")} stroke={METRIC_COLORS.pain} strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="avgEnergy" name={t("admin.outcomes.chart.energy")} stroke={METRIC_COLORS.energy} strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="avgSleep" name={t("admin.outcomes.chart.sleep")} stroke={METRIC_COLORS.sleep} strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="avgMood" name={t("admin.outcomes.chart.mood")} stroke={METRIC_COLORS.mood} strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Engagement — check-ins + unique users bar/area chart */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.outcomes.engagement.title")}</CardTitle>
          <CardDescription>
            {t("admin.outcomes.engagement.subtitle", { total: totals.totalCheckIns })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={engagementChartConfig} className="h-[300px] w-full">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="period" tick={{ fontSize: 10 }} tickFormatter={formatPeriodTick} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={30} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Legend />
              <Bar dataKey="checkIns" name={t("admin.outcomes.chart.checkInsPerPeriod")} fill={METRIC_COLORS.checkIns} radius={[4, 4, 0, 0]} />
              <Bar dataKey="uniqueUsers" name={t("admin.outcomes.chart.uniqueUsers")} fill={METRIC_COLORS.uniqueUsers} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Insights */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.outcomes.insights.title")}</CardTitle>
          <CardDescription>{t("admin.outcomes.insights.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="p-4 bg-muted/50 rounded-lg">
              <h4 className="font-medium mb-1">{t("admin.outcomes.insights.painManagement")}</h4>
              <p className="text-sm text-muted-foreground">
                {t("admin.outcomes.insights.painDescription", { value: totals.avgPain.toFixed(1) })}
                {totals.avgPain <= 3
                  ? ` ${t("admin.outcomes.insights.painLow")}`
                  : totals.avgPain <= 5
                  ? ` ${t("admin.outcomes.insights.painModerate")}`
                  : ` ${t("admin.outcomes.insights.painHigh")}`}
              </p>
            </div>

            <div className="p-4 bg-muted/50 rounded-lg">
              <h4 className="font-medium mb-1">{t("admin.outcomes.insights.energyWellbeing")}</h4>
              <p className="text-sm text-muted-foreground">
                {t("admin.outcomes.insights.energyDescription", {
                  energy: totals.avgEnergy.toFixed(1),
                  mood: totals.avgMood.toFixed(1),
                })}
                {totals.avgEnergy >= 6 && totals.avgMood >= 6
                  ? ` ${t("admin.outcomes.insights.energyGood")}`
                  : ` ${t("admin.outcomes.insights.energySupport")}`}
              </p>
            </div>

            <div className="p-4 bg-muted/50 rounded-lg">
              <h4 className="font-medium mb-1">{t("admin.outcomes.insights.sleepQuality")}</h4>
              <p className="text-sm text-muted-foreground">
                {t("admin.outcomes.insights.sleepDescription", { value: totals.avgSleep.toFixed(1) })}
                {totals.avgSleep >= 7
                  ? ` ${t("admin.outcomes.insights.sleepGood")}`
                  : totals.avgSleep >= 5
                  ? ` ${t("admin.outcomes.insights.sleepModerate")}`
                  : ` ${t("admin.outcomes.insights.sleepPoor")}`}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
