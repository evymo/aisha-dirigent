/**
 * Date range for the Fio API sync.
 *
 * Both values end up in the URL PATH
 * (`/periods/{token}/{from}/{to}/transactions.json`), next to the API token.
 * Anything other than a plain calendar date — `../`, `?`, `#`, `%2F` — would
 * steer the token-bearing request to a different Fio endpoint, so the range is
 * accepted only as `YYYY-MM-DD` that is a real date, with `from <= to`.
 * Missing values keep the previous defaults: the last 30 days up to today.
 */

export type FioDateRange =
  | { ok: true; fromDate: string; toDate: string }
  | { ok: false; reason: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  // Round-trip rejects dates that Date silently rolls over (2026-02-30).
  return !Number.isNaN(parsed.getTime()) && toIsoDate(parsed) === value;
}

export function resolveFioDateRange(
  input: { from_date?: unknown; to_date?: unknown },
  now: Date = new Date(),
): FioDateRange {
  const fromDate = input.from_date ?? toIsoDate(new Date(now.getTime() - DEFAULT_LOOKBACK_MS));
  const toDate = input.to_date ?? toIsoDate(now);

  if (typeof fromDate !== 'string' || !isCalendarDate(fromDate)) {
    return { ok: false, reason: 'from_date must be a calendar date in YYYY-MM-DD format' };
  }
  if (typeof toDate !== 'string' || !isCalendarDate(toDate)) {
    return { ok: false, reason: 'to_date must be a calendar date in YYYY-MM-DD format' };
  }
  if (fromDate > toDate) {
    return { ok: false, reason: 'from_date must not be after to_date' };
  }
  return { ok: true, fromDate, toDate };
}
