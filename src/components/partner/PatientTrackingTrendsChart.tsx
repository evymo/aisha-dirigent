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
  ResponsiveContainer,
} from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

interface TrackingCheckIn {
  id: string;
  check_in_date: string;
  pain_level: number | null;
  energy_level: number | null;
  sleep_quality: number | null;
  mood_level: number | null;
  sleep_hours: number | null;
}

interface ChartDataPoint {
  date: string;
  displayDate: string;
  pain: number | null;
  energy: number | null;
  sleep: number | null;
  mood: number | null;
}

interface UserTrackingTrendsChartProps {
  checkIns: TrackingCheckIn[];
}

export function UserTrackingTrendsChart({ checkIns }: UserTrackingTrendsChartProps) {
  const { t } = useTranslation();

  const chartConfig = {
    pain: {
      label: t("consultantDashboard.chart.pain"),
      color: "hsl(var(--destructive))",
    },
    energy: {
      label: t("consultantDashboard.chart.energy"),
      color: "hsl(var(--chart-2))",
    },
    sleep: {
      label: t("consultantDashboard.chart.sleep"),
      color: "hsl(var(--chart-3))",
    },
    mood: {
      label: t("consultantDashboard.chart.mood"),
      color: "hsl(var(--chart-4))",
    },
  };

  const chartData = useMemo(() => {
    if (!checkIns.length) return [];

    // Sort by date ascending and take the last 30 days
    const sortedCheckIns = [...checkIns]
      .sort((a, b) => new Date(a.check_in_date).getTime() - new Date(b.check_in_date).getTime())
      .slice(-30);

    return sortedCheckIns.map((checkIn): ChartDataPoint => ({
      date: checkIn.check_in_date,
      displayDate: format(new Date(checkIn.check_in_date), "MMM d"),
      pain: checkIn.pain_level,
      energy: checkIn.energy_level,
      sleep: checkIn.sleep_quality,
      mood: checkIn.mood_level,
    }));
  }, [checkIns]);

  if (!chartData.length) {
    return (
      <div className="h-[200px] flex items-center justify-center text-muted-foreground border rounded-lg bg-muted/20">
        {t("consultantDashboard.chart.noData")}
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="displayDate"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[0, 10]}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={25}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(value) => value}
              />
            }
          />
          <Legend wrapperStyle={{ fontSize: "12px" }} />
          <Line
            type="monotone"
            dataKey="pain"
            name={chartConfig.pain.label}
            stroke="var(--color-pain)"
            strokeWidth={2}
            dot={{ fill: "var(--color-pain)", r: 2 }}
            activeDot={{ r: 4 }}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="energy"
            name={chartConfig.energy.label}
            stroke="var(--color-energy)"
            strokeWidth={2}
            dot={{ fill: "var(--color-energy)", r: 2 }}
            activeDot={{ r: 4 }}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="sleep"
            name={chartConfig.sleep.label}
            stroke="var(--color-sleep)"
            strokeWidth={2}
            dot={{ fill: "var(--color-sleep)", r: 2 }}
            activeDot={{ r: 4 }}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="mood"
            name={chartConfig.mood.label}
            stroke="var(--color-mood)"
            strokeWidth={2}
            dot={{ fill: "var(--color-mood)", r: 2 }}
            activeDot={{ r: 4 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
