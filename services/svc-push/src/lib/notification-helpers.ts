/**
 * Shared notification-delivery helpers used by multiple push routes.
 */

export const parseTimeToMinutes = (time: string | null | undefined, fallbackMinutes: number): number => {
  if (!time) return fallbackMinutes;
  const [hourRaw, minuteRaw] = time.split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return fallbackMinutes;
  return hour * 60 + minute;
};

export const getLocalMinutes = (date: Date, timeZone: string): number => {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return hour * 60 + minute;
  } catch {
    return date.getHours() * 60 + date.getMinutes();
  }
};

export const getLocalDateKey = (date: Date, timeZone: string): string => {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find((p) => p.type === 'year')?.value ?? String(date.getUTCFullYear());
    const month = parts.find((p) => p.type === 'month')?.value ?? String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = parts.find((p) => p.type === 'day')?.value ?? String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return date.toISOString().split('T')[0];
  }
};

export const isWithinRange = (value: number, start: number, end: number): boolean => {
  if (start === end) return true;
  if (start < end) return value >= start && value < end;
  return value >= start || value < end;
};

export const chunk = <T>(items: T[], size = 500): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

export interface NotificationPreferences {
  user_id: string;
  push_enabled: boolean | null;
  push_reminders: boolean | null;
  push_study_updates: boolean | null;
  quiet_hours_enabled: boolean | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  morning_start: string | null;
  afternoon_start: string | null;
  evening_start: string | null;
  questionnaire_reminder_period: string | null;
  user_timezone: string | null;
}

export const shouldSendNow = (prefs: NotificationPreferences | undefined, now: Date): boolean => {
  if (!prefs) return true;
  if (prefs.push_enabled === false) return false;

  const timezone = prefs.user_timezone || 'UTC';
  const localMinutes = getLocalMinutes(now, timezone);

  const quietStart = parseTimeToMinutes(prefs.quiet_hours_start, 22 * 60);
  const quietEnd = parseTimeToMinutes(prefs.quiet_hours_end, 7 * 60);
  if (prefs.quiet_hours_enabled && isWithinRange(localMinutes, quietStart, quietEnd)) {
    return false;
  }

  const morning = parseTimeToMinutes(prefs.morning_start, 9 * 60);
  const afternoon = parseTimeToMinutes(prefs.afternoon_start, 14 * 60);
  const evening = parseTimeToMinutes(prefs.evening_start, 20 * 60);
  const period = prefs.questionnaire_reminder_period || 'morning';

  if (period === 'afternoon') return isWithinRange(localMinutes, afternoon, evening);
  if (period === 'evening') return isWithinRange(localMinutes, evening, morning);
  return isWithinRange(localMinutes, morning, afternoon);
};

export const normalizePayloadData = (
  data: Record<string, unknown> | null,
  extras: Record<string, string>,
): Record<string, string> => {
  const payload: Record<string, string> = { ...extras };
  if (!data) return payload;
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    payload[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return payload;
};
