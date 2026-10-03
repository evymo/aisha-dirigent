/**
 * Resolution order for display strings.
 *
 * The extranet is one class of DB translation: strings live in the
 * `translations` table, are edited in the admin translation UI, and reach this
 * shell through `get_translations`. The build-time bundle is a FLOOR (pre-auth,
 * offline, failed fetch) — never the authority, because it is frozen at build.
 *
 * So the order is DB → bundle → key, and the first of those is the whole point:
 * if the bundle won, editing a string in the admin UI would silently do nothing
 * until someone rebuilt and redeployed the surface, which is exactly the
 * file-shaped behaviour this replaced.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const BUNDLE = {
  en: { 'app.title': 'Bundle title', 'app.only.bundle': 'Only in bundle' },
  cs: { 'app.title': 'Bundle nadpis' },
};

vi.mock('../src/instance.js', () => ({
  instance: {
    config: {
      instance_slug: 'test',
      i18n: { locales: ['en', 'cs'], default_locale: 'en' },
    },
    i18n: BUNDLE,
  },
}));

async function freshI18n() {
  vi.resetModules();
  return await import('../src/i18n.js');
}

const rows = (...r: [string, string, string][]) =>
  r.map(([key, locale, value]) => ({ key, locale, value }));

describe('t() resolution order', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear?.();
  });

  it('falls back to the build-time bundle before translations load', async () => {
    const { t } = await freshI18n();
    expect(t('app.title')).toBe('Bundle title');
  });

  it('returns the key itself when neither source has it (a visible key IS the report)', async () => {
    const { t } = await freshI18n();
    expect(t('app.nowhere')).toBe('app.nowhere');
  });

  it('DB value WINS over the bundle once loaded — the point of the migration', async () => {
    const { t, loadTranslations } = await freshI18n();
    await loadTranslations(async () => rows(['app.title', 'en', 'From the database']));
    expect(t('app.title')).toBe('From the database');
  });

  it('keeps serving the bundle for keys the DB does not carry', async () => {
    const { t, loadTranslations } = await freshI18n();
    await loadTranslations(async () => rows(['app.title', 'en', 'From the database']));
    expect(t('app.only.bundle')).toBe('Only in bundle');
  });

  it('falls back across locales inside the DB before dropping to the bundle', async () => {
    const { t, loadTranslations } = await freshI18n();
    await loadTranslations(async () => rows(['app.title', 'en', 'DB english']));
    // cs exists in the bundle, but the DB's en fallback outranks it: the DB is
    // the authority, so a stale bundle translation must not shadow a fresh one.
    expect(t('app.title', 'cs')).toBe('DB english');
  });

  it('a failed fetch degrades to the bundle instead of taking the surface down', async () => {
    const { t, loadTranslations, translationsLoaded } = await freshI18n();
    const ok = await loadTranslations(async () => {
      throw new Error('postgrest unreachable');
    });
    expect(ok).toBe(false);
    expect(translationsLoaded()).toBe(false);
    expect(t('app.title')).toBe('Bundle title');
  });

  it('an empty namespace counts as NOT loaded (never report success on nothing)', async () => {
    const { loadTranslations, translationsLoaded } = await freshI18n();
    expect(await loadTranslations(async () => [])).toBe(false);
    expect(translationsLoaded()).toBe(false);
  });

  it('requests the extranet namespace by default', async () => {
    const { loadTranslations } = await freshI18n();
    const seen: string[] = [];
    await loadTranslations(async (ns) => {
      seen.push(ns);
      return [];
    });
    expect(seen).toEqual(['extranet']);
  });
});
