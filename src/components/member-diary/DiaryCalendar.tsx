/**
 * Diary Calendar
 * Monthly calendar view with activity icons
 */

import { useTranslation } from "react-i18next";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChevronLeft,
  ChevronRight,
  Package,
} from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isToday,
  addMonths,
  subMonths,
  getDay,
} from "date-fns";
import type { MemberDiaryCalendarResponse } from "@/lib/schemas/memberDiarySchemas";

interface DiaryCalendarProps {
  calendarData: MemberDiaryCalendarResponse | undefined;
  selectedMonth: Date;
  onMonthChange: (month: Date) => void;
  onDayClick: (date: Date) => void;
  isLoading?: boolean;
}

export function DiaryCalendar({
  calendarData,
  selectedMonth,
  onMonthChange,
  onDayClick,
  isLoading: _isLoading,
}: DiaryCalendarProps) {
  const { t, i18n } = useTranslation();
  const locale = getDateFnsLocale(i18n.language);

  const monthStart = startOfMonth(selectedMonth);
  const monthEnd = endOfMonth(selectedMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Get weekday headers
  const weekDays = [
    t("memberDiary.calendar.weekDays.mon"),
    t("memberDiary.calendar.weekDays.tue"),
    t("memberDiary.calendar.weekDays.wed"),
    t("memberDiary.calendar.weekDays.thu"),
    t("memberDiary.calendar.weekDays.fri"),
    t("memberDiary.calendar.weekDays.sat"),
    t("memberDiary.calendar.weekDays.sun"),
  ];

  // Get start day offset (Monday = 0)
  const startDayOffset = (getDay(monthStart) + 6) % 7;

  const getDayData = (date: Date) => {
    if (!calendarData?.days) return null;
    const dateStr = format(date, "yyyy-MM-dd");
    return calendarData.days.find((d) => d.date === dateStr);
  };

  const renderDayIcons = (dayData: NonNullable<MemberDiaryCalendarResponse["days"]>[number]) => {
    const icons: React.ReactNode[] = [];

    if (dayData.products_taken > 0) {
      icons.push(
        <div
          key="products"
          className="w-2 h-2 rounded-full bg-primary"
          title={t("memberDiary.productsTaken", { count: dayData.products_taken })}
        />
      );
    }

    if (dayData.states_logged > 0) {
      icons.push(
        <div
          key="states"
          className={cn(
            "w-2 h-2 rounded-full",
            dayData.has_active_issues ? "bg-warning" : "bg-success"
          )}
          title={t("memberDiary.statesLogged", { count: dayData.states_logged })}
        />
      );
    }

    if (dayData.distribution_received) {
      icons.push(
        <div
          key="distribution"
          className="w-2 h-2 rounded-full bg-accent"
          title={t("memberDiary.distributionReceived")}
        />
      );
    }

    return icons;
  };

  return (
    <div className="p-6">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">
              {format(selectedMonth, "LLLL yyyy", { locale })}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => onMonthChange(subMonths(selectedMonth, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onMonthChange(new Date())}
              >
                {t("memberDiary.today")}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => onMonthChange(addMonths(selectedMonth, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {weekDays.map((day) => (
              <div
                key={day}
                className="text-center text-sm font-medium text-muted-foreground py-2"
              >
                {day}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {/* Empty cells for offset */}
            {Array.from({ length: startDayOffset }).map((_, i) => (
              <div key={`empty-${i}`} className="aspect-square" />
            ))}

            {/* Days */}
            {days.map((day) => {
              const dayData = getDayData(day);
              const hasActivity = dayData && (
                dayData.products_taken > 0 ||
                dayData.states_logged > 0 ||
                dayData.distribution_received
              );

              return (
                <button
                  key={day.toISOString()}
                  onClick={() => onDayClick(day)}
                  className={cn(
                    "aspect-square p-1 rounded-lg flex flex-col items-center justify-center gap-1",
                    "hover:bg-accent/50 transition-colors",
                    isToday(day) && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                    !isSameMonth(day, selectedMonth) && "text-muted-foreground opacity-50"
                  )}
                >
                  <span className="text-sm">{format(day, "d")}</span>
                  {hasActivity && (
                    <div className="flex gap-0.5">
                      {renderDayIcons(dayData)}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-primary" />
              <span>{t("memberDiary.legendProducts")}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-success" />
              <span>{t("memberDiary.legendStatesOk")}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-warning" />
              <span>{t("memberDiary.legendStatesIssue")}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-accent" />
              <span>{t("memberDiary.legendDistribution")}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Distributions this month */}
      {calendarData?.distributions && calendarData.distributions.length > 0 && (
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4" />
              {t("memberDiary.distributionsThisMonth")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {calendarData.distributions.map((dist, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-sm py-2 border-b border-border last:border-0"
                >
                  <span className="font-medium">{dist.status}</span>
                  <span className="text-muted-foreground">
                    {format(new Date(dist.date), "d. M. yyyy", { locale })} • {dist.vial_count ?? 0}x
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
