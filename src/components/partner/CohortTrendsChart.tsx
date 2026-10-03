import { useTranslation } from "react-i18next";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { format } from "date-fns";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export interface CohortTrendData {
  study_id: string;
  week_start: string;
  participant_count: number;
  avg_pain: number | null;
  avg_energy: number | null;
  avg_mood: number | null;
  avg_sleep_quality: number | null;
  avg_sleep_hours: number | null;
  check_in_count: number;
}

export interface CohortLabTrendData {
  study_id: string;
  month_start: string;
  participant_count: number;
  avg_crp: number | null;
  avg_vitamin_d: number | null;
  avg_glucose: number | null;
  avg_cholesterol: number | null;
  avg_hemoglobin: number | null;
  lab_count: number;
}

interface CohortTrackingTrendsChartProps {
  data: CohortTrendData[];
}

interface CohortLabTrendsChartProps {
  data: CohortLabTrendData[];
}

export function CohortTrackingTrendsChart({ data }: CohortTrackingTrendsChartProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);

  if (!data || data.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
        {t("partnerUsers.cohort.noTrendData")}
      </div>
    );
  }

  const chartData = data.map((item) => ({
    week: format(new Date(item.week_start), "MMM d", { locale: dateLocale }),
    pain: item.avg_pain,
    energy: item.avg_energy,
    mood: item.avg_mood,
    sleep: item.avg_sleep_quality,
    participants: item.participant_count,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis 
          dataKey="week" 
          tick={{ fontSize: 11 }} 
          className="text-muted-foreground"
        />
        <YAxis 
          domain={[0, 10]} 
          tick={{ fontSize: 11 }} 
          className="text-muted-foreground"
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--background))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "6px",
            fontSize: "12px",
          }}
          labelStyle={{ fontWeight: "bold" }}
        />
        <Legend wrapperStyle={{ fontSize: "11px" }} />
        <Line
          type="monotone"
          dataKey="pain"
          name={t("partnerUsers.cohort.pain")}
          stroke="hsl(var(--destructive))"
          strokeWidth={2}
          dot={{ r: 3 }}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="energy"
          name={t("partnerUsers.cohort.energy")}
          stroke="hsl(var(--chart-2))"
          strokeWidth={2}
          dot={{ r: 3 }}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="mood"
          name={t("partnerUsers.cohort.mood")}
          stroke="hsl(var(--chart-4))"
          strokeWidth={2}
          dot={{ r: 3 }}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="sleep"
          name={t("partnerUsers.cohort.sleepQuality")}
          stroke="hsl(var(--chart-3))"
          strokeWidth={2}
          dot={{ r: 3 }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function CohortLabTrendsChart({ data }: CohortLabTrendsChartProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);

  if (!data || data.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
        {t("partnerUsers.cohort.noTrendData")}
      </div>
    );
  }

  const chartData = data.map((item) => ({
    month: format(new Date(item.month_start), "MMM yyyy", { locale: dateLocale }),
    crp: item.avg_crp,
    vitaminD: item.avg_vitamin_d,
    glucose: item.avg_glucose,
    participants: item.participant_count,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis 
          dataKey="month" 
          tick={{ fontSize: 11 }} 
          className="text-muted-foreground"
        />
        <YAxis 
          tick={{ fontSize: 11 }} 
          className="text-muted-foreground"
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--background))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "6px",
            fontSize: "12px",
          }}
          labelStyle={{ fontWeight: "bold" }}
        />
        <Legend wrapperStyle={{ fontSize: "11px" }} />
        <Line
          type="monotone"
          dataKey="crp"
          name="CRP (mg/L)"
          stroke="hsl(var(--destructive))"
          strokeWidth={2}
          dot={{ r: 3 }}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="vitaminD"
          name="Vitamin D (ng/mL)"
          stroke="hsl(var(--chart-2))"
          strokeWidth={2}
          dot={{ r: 3 }}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="glucose"
          name="Glucose (mg/dL)"
          stroke="hsl(var(--chart-4))"
          strokeWidth={2}
          dot={{ r: 3 }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
