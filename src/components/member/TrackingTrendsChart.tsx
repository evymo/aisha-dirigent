import { useMemo } from "react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { useTrackingCheckIns } from "@/hooks/useTracking";
import { TrendingUp } from "lucide-react";

interface ChartDataPoint {
  date: string;
  displayDate: string;
  pain: number | null;
  energy: number | null;
  sleep: number | null;
  mood: number | null;
}

export function TrackingTrendsChart() {
  const { t } = useTranslation();
  const { checkIns, loading } = useTrackingCheckIns(30);

  const chartConfig = {
    pain: {
      label: t("trackingTrends.labels.pain"),
      color: "hsl(0, 72%, 50%)",
    },
    energy: {
      label: t("trackingTrends.labels.energy"),
      color: "hsl(210, 70%, 35%)",
    },
    sleep: {
      label: t("trackingTrends.labels.sleep"),
      color: "hsl(150, 35%, 40%)",
    },
    mood: {
      label: t("trackingTrends.labels.mood"),
      color: "hsl(30, 60%, 50%)",
    },
  };

  const chartData = useMemo(() => {
    if (!checkIns.length) return [];

    // Sort by date ascending and take the last 14 days
    const sortedCheckIns = [...checkIns]
      .sort((a, b) => new Date(a.check_in_date).getTime() - new Date(b.check_in_date).getTime())
      .slice(-14);

    return sortedCheckIns.map((checkIn): ChartDataPoint => ({
      date: checkIn.check_in_date,
      displayDate: format(new Date(checkIn.check_in_date), "MMM d"),
      pain: checkIn.pain_level,
      energy: checkIn.energy_level,
      sleep: checkIn.sleep_quality,
      mood: checkIn.mood_level,
    }));
  }, [checkIns]);

  const averages = useMemo(() => {
    if (!checkIns.length) return { pain: 0, energy: 0, sleep: 0, mood: 0 };

    const validPain = checkIns.filter(c => c.pain_level !== null);
    const validEnergy = checkIns.filter(c => c.energy_level !== null);
    const validSleep = checkIns.filter(c => c.sleep_quality !== null);
    const validMood = checkIns.filter(c => c.mood_level !== null);

    return {
      pain: validPain.length ? validPain.reduce((sum, c) => sum + (c.pain_level || 0), 0) / validPain.length : 0,
      energy: validEnergy.length ? validEnergy.reduce((sum, c) => sum + (c.energy_level || 0), 0) / validEnergy.length : 0,
      sleep: validSleep.length ? validSleep.reduce((sum, c) => sum + (c.sleep_quality || 0), 0) / validSleep.length : 0,
      mood: validMood.length ? validMood.reduce((sum, c) => sum + (c.mood_level || 0), 0) / validMood.length : 0,
    };
  }, [checkIns]);

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="h-[300px] flex items-center justify-center">
            <div className="animate-pulse text-muted-foreground">{t("trackingTrends.loading")}</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!chartData.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            {t("trackingTrends.title")}
          </CardTitle>
          <CardDescription>{t("trackingTrends.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[200px] flex items-center justify-center text-muted-foreground">
            {t("trackingTrends.noData")}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5" />
          {t("trackingTrends.title")}
        </CardTitle>
        <CardDescription>
          {t("trackingTrends.checkInsCount", { count: chartData.length })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[300px] w-full">
          <LineChart
            data={chartData}
            margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="displayDate"
              tick={{ fontSize: 12 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={[0, 10]}
              tick={{ fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={30}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => `Date: ${value}`}
                />
              }
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="pain"
              name={t("trackingTrends.labels.pain")}
              stroke="var(--color-pain)"
              strokeWidth={2}
              dot={{ fill: "var(--color-pain)", r: 3 }}
              activeDot={{ r: 5 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="energy"
              name={t("trackingTrends.labels.energy")}
              stroke="var(--color-energy)"
              strokeWidth={2}
              dot={{ fill: "var(--color-energy)", r: 3 }}
              activeDot={{ r: 5 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="sleep"
              name={t("trackingTrends.labels.sleep")}
              stroke="var(--color-sleep)"
              strokeWidth={2}
              dot={{ fill: "var(--color-sleep)", r: 3 }}
              activeDot={{ r: 5 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="mood"
              name={t("trackingTrends.labels.mood")}
              stroke="var(--color-mood)"
              strokeWidth={2}
              dot={{ fill: "var(--color-mood)", r: 3 }}
              activeDot={{ r: 5 }}
              connectNulls
            />
          </LineChart>
        </ChartContainer>

        {/* Averages Summary */}
        <div className="grid grid-cols-4 gap-4 mt-6 pt-6 border-t">
          <div className="text-center">
            <div className="text-2xl font-semibold" style={{ color: chartConfig.pain.color }}>
              {averages.pain.toFixed(1)}
            </div>
            <div className="text-xs text-muted-foreground">{t("trackingTrends.avgPain")}</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-semibold" style={{ color: chartConfig.energy.color }}>
              {averages.energy.toFixed(1)}
            </div>
            <div className="text-xs text-muted-foreground">{t("trackingTrends.avgEnergy")}</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-semibold" style={{ color: chartConfig.sleep.color }}>
              {averages.sleep.toFixed(1)}
            </div>
            <div className="text-xs text-muted-foreground">{t("trackingTrends.avgSleep")}</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-semibold" style={{ color: chartConfig.mood.color }}>
              {averages.mood.toFixed(1)}
            </div>
            <div className="text-xs text-muted-foreground">{t("trackingTrends.avgMood")}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}