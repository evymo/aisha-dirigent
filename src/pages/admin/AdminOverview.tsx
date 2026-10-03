import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useStudies } from "@/hooks/useStudies";
import { useAggregateTrackingData, useAllRegistrations, useMembersSummary } from "@/hooks/useAdminData";
import { usePlatformWarmupState } from "@/hooks/usePlatformWarmupState";
import { Users, FlaskConical, Activity, Heart, Zap, Moon, TrendingUp } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

export default function AdminOverview() {
  const { t } = useTranslation();

  // Step W1: redirect to /admin/warmup on first admin login after a
  // fresh install / cold-start wipe. The hook resolves to undefined
  // while loading (no redirect); once it returns and needs_warmup is
  // true the admin is sent to the wizard. The wizard's own page is
  // safe to land on directly — it shows the same Done state when
  // needs_warmup is false.
  // All hooks must be called unconditionally before any early-return per
  // react-hooks/rules-of-hooks. The early-return for warmup happens AFTER
  // hooks resolve; that's safe because TanStack Query short-circuits when
  // the component unmounts before render completes.
  const { data: warmupState } = usePlatformWarmupState();
  const { studies } = useStudies();
  const { registrations } = useAllRegistrations();
  const { members } = useMembersSummary();
  const { data: healthData, loading: healthLoading } = useAggregateTrackingData();

  if (warmupState?.needs_warmup) {
    return <Navigate to="/admin/warmup" replace />;
  }

  const chartConfig = {
    checkIns: {
      label: t("admin.overview.charts.checkIns"),
      color: "hsl(210, 70%, 35%)",
    },
  } as const;

  const activeRegistrations = registrations.filter(
    (e) => e.status === "enrolled" || e.status === "active"
  );

  const statusCounts = registrations.reduce((acc, e) => {
    acc[e.status] = (acc[e.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">{t("admin.overview.title")}</h1>
        <p className="text-muted-foreground mt-1">
          {t("admin.overview.subtitle")}
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.overview.stats.totalMembers")}</p>
                <p className="text-2xl font-semibold">{members.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-secondary/10">
                <FlaskConical className="w-5 h-5 text-secondary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.overview.stats.activeStudies")}</p>
                <p className="text-2xl font-semibold">{studies.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent/10">
                <TrendingUp className="w-5 h-5 text-accent" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.overview.stats.activeRegistrations")}</p>
                <p className="text-2xl font-semibold">{activeRegistrations.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted">
                <Activity className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.overview.stats.totalCheckIns")}</p>
                <p className="text-2xl font-semibold">{healthData?.totalCheckIns || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tracking Metrics Overview */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("admin.overview.trackingMetrics.title")}</CardTitle>
            <CardDescription>{t("admin.overview.trackingMetrics.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            {healthLoading ? (
              <div className="h-32 flex items-center justify-center text-muted-foreground">
                {t("common.loading")}
              </div>
            ) : healthData ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-destructive/10 rounded-lg text-center">
                  <Heart className="w-6 h-6 mx-auto text-destructive mb-2" />
                  <p className="text-2xl font-semibold">{healthData.avgPainLevel.toFixed(1)}</p>
                  <p className="text-sm text-muted-foreground">{t("admin.overview.trackingMetrics.avgPain")}</p>
                </div>
                <div className="p-4 bg-primary/10 rounded-lg text-center">
                  <Zap className="w-6 h-6 mx-auto text-primary mb-2" />
                  <p className="text-2xl font-semibold">{healthData.avgEnergyLevel.toFixed(1)}</p>
                  <p className="text-sm text-muted-foreground">{t("admin.overview.trackingMetrics.avgEnergy")}</p>
                </div>
                <div className="p-4 bg-secondary/10 rounded-lg text-center">
                  <Moon className="w-6 h-6 mx-auto text-secondary mb-2" />
                  <p className="text-2xl font-semibold">{healthData.avgSleepQuality.toFixed(1)}</p>
                  <p className="text-sm text-muted-foreground">{t("admin.overview.trackingMetrics.avgSleep")}</p>
                </div>
                <div className="p-4 bg-accent/10 rounded-lg text-center">
                  <Activity className="w-6 h-6 mx-auto text-accent mb-2" />
                  <p className="text-2xl font-semibold">{healthData.avgMoodLevel.toFixed(1)}</p>
                  <p className="text-sm text-muted-foreground">{t("admin.overview.trackingMetrics.avgMood")}</p>
                </div>
              </div>
            ) : (
              <div className="h-32 flex items-center justify-center text-muted-foreground">
                {t("admin.overview.trackingMetrics.noData")}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("admin.overview.registrationStatus.title")}</CardTitle>
            <CardDescription>{t("admin.overview.registrationStatus.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(statusCounts).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Badge variant={
                      status === "active" ? "default" :
                      status === "completed" ? "secondary" :
                      status === "withdrawn" ? "destructive" : "outline"
                    }>
                      {status}
                    </Badge>
                  </div>
                  <span className="font-semibold">{count}</span>
                </div>
              ))}
              {Object.keys(statusCounts).length === 0 && (
                <div className="text-center text-muted-foreground py-6">
                  {t("admin.overview.registrationStatus.noRegistrations")}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Check-ins Over Time */}
      {healthData && healthData.checkInsByDate.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("admin.overview.checkInsOverTime.title")}</CardTitle>
            <CardDescription>{t("admin.overview.checkInsOverTime.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <BarChart data={healthData.checkInsByDate} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                  }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={30} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="count" name="Check-ins" fill="var(--color-checkIns)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.overview.recentRegistrations.title")}</CardTitle>
          <CardDescription>{t("admin.overview.recentRegistrations.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {registrations.length > 0 ? (
            <div className="space-y-3">
              {registrations.slice(0, 5).map((registration) => (
                <div key={registration.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <p className="font-medium">
                      {registration.profile?.display_name || registration.profile?.email || t("admin.overview.recentRegistrations.unknownUser")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {registration.study?.name || t("admin.overview.recentRegistrations.unknownStudy")} • {registration.study?.code}
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge variant={
                      registration.status === "active" ? "default" :
                      registration.status === "completed" ? "secondary" :
                      registration.status === "withdrawn" ? "destructive" : "outline"
                    }>
                      {registration.status}
                    </Badge>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(registration.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-6">
              {t("admin.overview.recentRegistrations.noRegistrations")}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
