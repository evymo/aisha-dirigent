import { describe, expect, it } from 'vitest';

const bundle = {
  config: {
    instance_slug: 'test',
    api: { postgrest_url: 'http://x', token_exchange_url: 'http://x' },
    auth: { issuer: 'http://x', client_id: 'c' },
    i18n: { default_locale: 'cs', locales: ['cs', 'en'] },
    snapshot_public_jwk: null,
    preview: { enabled: false }
  },
  i18n: {
    en: { 'app.title': 'Title EN', 'app.wb.surface': 'Workbench' },
    cs: { 'app.title': 'Titulek CS' }
  }
};

(globalThis as Record<string, unknown>).__AISHA_INSTANCE__ = bundle;
const { t, getLocale, setLocale } = await import('../src/i18n.js');

describe('key-first i18n resolver (workbench)', () => {
  it('uses the instance default locale', () => {
    expect(getLocale()).toBe('cs');
    expect(t('app.title')).toBe('Titulek CS');
  });

  it('falls back to en when the key is missing in the current locale', () => {
    expect(t('app.wb.surface')).toBe('Workbench');
  });

  it('returns the KEY itself when untranslated (visible gap, never invented text)', () => {
    expect(t('app.nonexistent_key')).toBe('app.nonexistent_key');
  });

  it('ignores locales outside the instance allowlist', () => {
    setLocale('de');
    expect(getLocale()).toBe('cs');
    setLocale('en');
    expect(getLocale()).toBe('en');
    expect(t('app.title')).toBe('Title EN');
  });
});
