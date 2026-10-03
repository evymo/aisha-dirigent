import { instance } from './instance.js';

/** Key-first i18n (gate contract parity with domain templates): the shell never
 * contains display strings — only keys resolved against the instance dictionary.
 */

const FALLBACK = 'en';
const storageKey = (): string => `aisha.${instance.config.instance_slug}.wb.locale`;

let current: string | null = null;

export function getLocale(): string {
  if (current) return current;
  let stored: string | null = null;
  try {
    stored = globalThis.localStorage?.getItem(storageKey()) ?? null;
  } catch {
    stored = null;
  }
  current =
    stored && instance.config.i18n.locales.includes(stored)
      ? stored
      : instance.config.i18n.default_locale;
  return current;
}

export function setLocale(locale: string): void {
  if (!instance.config.i18n.locales.includes(locale)) return;
  current = locale;
  try {
    globalThis.localStorage?.setItem(storageKey(), locale);
  } catch {
    /* storage unavailable — in-memory only */
  }
}

export function availableLocales(): string[] {
  return instance.config.i18n.locales;
}

/**
 * Display strings loaded from the DB at runtime (`translations` table via
 * `get_translations`) — the same source the admin translation UI writes to, so a
 * string edited there reaches this shell without a rebuild or a redeploy.
 *
 * Empty until `loadTranslations()` resolves. `t()` stays SYNCHRONOUS on purpose:
 * it is called from module scope (main.tsx sets document.title before React
 * mounts) and from every render path, so making it async would rewrite the whole
 * shell to buy nothing.
 */
const runtime: Record<string, Record<string, string>> = {};
let loaded = false;

/**
 * Fill the runtime dictionary. Call once, AFTER authentication — the extranet is
 * always authenticated and `get_translations` runs as the caller.
 *
 * Failure is deliberately soft: a surface that renders keys is degraded, a
 * surface that refuses to render is down. The build-time bundle still backs
 * `t()`, so a failed fetch falls back to the shipped inventory rather than to
 * raw keys.
 */
export async function loadTranslations(
  fetcher: (ns: string) => Promise<{ key: string; locale: string; value: string }[]>,
  namespace = 'extranet'
): Promise<boolean> {
  try {
    const rows = await fetcher(namespace);
    for (const { key, locale, value } of rows) {
      (runtime[locale] ??= {})[key] = value;
    }
    loaded = rows.length > 0;
    return loaded;
  } catch {
    return false;
  }
}

export function translationsLoaded(): boolean {
  return loaded;
}

/**
 * Resolve key → DB (current locale, then fallback) → build-time bundle → the key
 * itself (a visible key means a missing translation, which is the point).
 *
 * The DB is consulted first so an edit in the translation UI wins over whatever
 * the bundle was built with. The bundle remains as the pre-auth and
 * fetch-failure floor — it cannot be the authority, because it is frozen at
 * build time.
 */
export function t(key: string, locale: string = getLocale()): string {
  return (
    runtime[locale]?.[key] ??
    runtime[FALLBACK]?.[key] ??
    instance.i18n[locale]?.[key] ??
    instance.i18n[FALLBACK]?.[key] ??
    key
  );
}

export function formatNumber(value: number | string, opts?: Intl.NumberFormatOptions): string {
  if (typeof value === 'string') return value;
  return new Intl.NumberFormat(getLocale(), opts).format(value);
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}
