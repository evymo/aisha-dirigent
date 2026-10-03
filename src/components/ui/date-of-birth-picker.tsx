import * as React from "react";
import { useTranslation } from "react-i18next";
import { Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

interface DateOfBirthPickerProps {
  value?: Date;
  onChange: (date: Date | undefined) => void;
  fromYear?: number;
  toYear?: number;
  disabled?: boolean;
  className?: string;
}

/**
 * Date of birth picker optimised for quick year navigation.
 *
 * Uses three native `<select>` dropdowns (day, month, year).
 * The year dropdown is descending (newest first) and automatically
 * scrolls to approximately 40 years ago on first focus so the user
 * does not need to scroll through 100+ options manually.
 *
 * Works well in jsdom for testing — no external date-picker library needed.
 */
export function DateOfBirthPicker({
  value,
  onChange,
  fromYear = 1920,
  toYear = new Date().getFullYear(),
  disabled = false,
  className,
}: DateOfBirthPickerProps) {
  const { t, i18n } = useTranslation();
  const yearSelectRef = React.useRef<HTMLSelectElement>(null);
  const hasScrolledYear = React.useRef(false);

  // Local state for partial selections
  const [localDay, setLocalDay] = React.useState<number | undefined>(
    value?.getDate(),
  );
  const [localMonth, setLocalMonth] = React.useState<number | undefined>(
    value ? value.getMonth() + 1 : undefined,
  );
  const [localYear, setLocalYear] = React.useState<number | undefined>(
    value?.getFullYear(),
  );

  // Sync local state when value prop changes from outside
  React.useEffect(() => {
    setLocalDay(value?.getDate());
    setLocalMonth(value ? value.getMonth() + 1 : undefined);
    setLocalYear(value?.getFullYear());
  }, [value]);

  // Generate year options (descending from toYear)
  const years = React.useMemo(() => {
    const result: number[] = [];
    for (let y = toYear; y >= fromYear; y--) {
      result.push(y);
    }
    return result;
  }, [fromYear, toYear]);

  // Generate localized month names
  const months = React.useMemo(() => {
    const formatter = new Intl.DateTimeFormat(i18n.language, { month: "long" });
    return Array.from({ length: 12 }, (_, i) => ({
      value: i + 1,
      label: formatter.format(new Date(2000, i, 1)),
    }));
  }, [i18n.language]);

  // Generate day options based on selected month/year
  const days = React.useMemo(() => {
    let daysInMonth = 31;
    if (localMonth && localYear) {
      daysInMonth = new Date(localYear, localMonth, 0).getDate();
    } else if (localMonth) {
      daysInMonth = new Date(2000, localMonth, 0).getDate();
    }
    return Array.from({ length: daysInMonth }, (_, i) => i + 1);
  }, [localMonth, localYear]);

  // Scroll year dropdown to ~40 years ago on first open (once)
  const handleYearFocus = React.useCallback(() => {
    if (localYear || hasScrolledYear.current) return;
    hasScrolledYear.current = true;

    const target = new Date().getFullYear() - 40;

    requestAnimationFrame(() => {
      const el = yearSelectRef.current;
      if (!el) return;

      const option = el.querySelector<HTMLOptionElement>(
        `option[value="${String(target)}"]`,
      );
      option?.scrollIntoView({ block: "center" });
    });
  }, [localYear]);

  const handleChange = (type: "day" | "month" | "year", val: string) => {
    const numVal = val ? parseInt(val, 10) : undefined;

    let newDay = type === "day" ? numVal : localDay;
    const newMonth = type === "month" ? numVal : localMonth;
    const newYear = type === "year" ? numVal : localYear;

    // Update local state immediately
    if (type === "day") setLocalDay(numVal);
    if (type === "month") setLocalMonth(numVal);
    if (type === "year") setLocalYear(numVal);

    // If all parts are selected, create a Date and call onChange
    if (newDay && newMonth && newYear) {
      // Clamp day to valid range for month
      const maxDay = new Date(newYear, newMonth, 0).getDate();
      if (newDay > maxDay) {
        newDay = maxDay;
        setLocalDay(newDay);
      }
      onChange(new Date(newYear, newMonth - 1, newDay));
    } else if (!newDay && !newMonth && !newYear) {
      onChange(undefined);
    }
    // If partial, wait for all fields to be filled
  };

  const selectBaseClass = cn(
    "h-10 rounded-md border border-input bg-background px-3 py-2 text-sm",
    "ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
    "disabled:cursor-not-allowed disabled:opacity-50",
    "appearance-none cursor-pointer",
  );

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />

      {/* Day */}
      <select
        value={localDay ?? ""}
        onChange={(e) => handleChange("day", e.target.value)}
        disabled={disabled}
        className={cn(selectBaseClass, "w-[70px]")}
        aria-label={t("common.day")}
        data-testid="dob-day"
      >
        <option value="">{t("common.day")}</option>
        {days.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>

      {/* Month */}
      <select
        value={localMonth ?? ""}
        onChange={(e) => handleChange("month", e.target.value)}
        disabled={disabled}
        className={cn(selectBaseClass, "flex-1 min-w-[100px]")}
        aria-label={t("common.month")}
        data-testid="dob-month"
      >
        <option value="">{t("common.month")}</option>
        {months.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>

      {/* Year — descending, scrolls to ~40 years ago on focus */}
      <select
        ref={yearSelectRef}
        value={localYear ?? ""}
        onChange={(e) => handleChange("year", e.target.value)}
        onFocus={handleYearFocus}
        disabled={disabled}
        className={cn(selectBaseClass, "w-[90px]")}
        aria-label={t("common.year")}
        data-testid="dob-year"
      >
        <option value="">{t("common.year")}</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}
