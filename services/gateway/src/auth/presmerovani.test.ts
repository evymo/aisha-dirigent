/**
 * Odvození adres přihlášení a allowlistu přesměrování (auth/presmerovani.ts).
 *
 * ⛔ NAMĚŘENO 2026-10-01: produkce běžela s vývojářským allowlistem (localhost, vlastní
 * schémata, https://vscode.dev/redirect*), protože FRONTEND_URL / PUBLIC_URL /
 * ALLOWED_REDIRECT_URIS nikdo nedoručoval. Tenhle test drží VLASTNOST: v produkci se
 * do allowlistu nedostane nic, co instance nedeklarovala.
 */
import { describe, expect, it } from 'vitest';
import { odvodPresmerovani } from './presmerovani.js';

const PRODUKCE = { NODE_ENV: 'production' } as const;
const vyvojarske = /localhost|127\.0\.0\.1|vscode|aisha-dirigent:|\*/;

describe('odvodPresmerovani', () => {
  it('produkce bez domén: nic se nehádá — prázdné adresy, prázdný allowlist', () => {
    expect(odvodPresmerovani({ ...PRODUKCE })).toEqual({ publicUrl: '', frontendUrl: '', allowedRedirectUris: [] });
  });

  it('produkce s doménami: https adresy z domén, allowlist = jen origin frontendu', () => {
    const p = odvodPresmerovani({ ...PRODUKCE, API_DOMAIN_PUBLIC: 'api.example.test', APP_DOMAIN: 'web.example.test' });
    expect(p).toEqual({
      publicUrl: 'https://api.example.test',
      frontendUrl: 'https://web.example.test',
      allowedRedirectUris: ['https://web.example.test'],
    });
  });

  it('VLASTNOST: v produkci bez výslovného ALLOWED_REDIRECT_URIS není v allowlistu nic vývojářského', () => {
    const varianty = [
      {},
      { APP_DOMAIN: 'web.example.test' },
      { API_DOMAIN_PUBLIC: 'api.example.test' },
      { FRONTEND_URL: 'https://app.example.test/', PUBLIC_URL: 'https://api.example.test' },
    ];
    for (const v of varianty) {
      const { allowedRedirectUris } = odvodPresmerovani({ ...PRODUKCE, ...v });
      for (const u of allowedRedirectUris) expect(u, JSON.stringify(v)).not.toMatch(vyvojarske);
    }
  });

  it('výslovné hodnoty operátora mají přednost před odvozenými', () => {
    const p = odvodPresmerovani({
      ...PRODUKCE,
      APP_DOMAIN: 'web.example.test',
      API_DOMAIN_PUBLIC: 'api.example.test',
      FRONTEND_URL: 'https://jinde.example.test/',
      PUBLIC_URL: 'https://brana.example.test',
      ALLOWED_REDIRECT_URIS: ' https://jinde.example.test , https://druha.example.test/** ',
    });
    expect(p).toEqual({
      publicUrl: 'https://brana.example.test',
      frontendUrl: 'https://jinde.example.test',
      allowedRedirectUris: ['https://jinde.example.test', 'https://druha.example.test/**'],
    });
  });

  it('doména zapsaná jako URL s lomítkem na konci se normalizuje', () => {
    expect(odvodPresmerovani({ ...PRODUKCE, APP_DOMAIN: 'https://web.example.test/' }).frontendUrl).toBe(
      'https://web.example.test',
    );
  });

  it('prázdný řetězec v env se bere jako nenastavený (neblokuje odvození)', () => {
    const p = odvodPresmerovani({ ...PRODUKCE, FRONTEND_URL: '', APP_DOMAIN: 'web.example.test' });
    expect(p.frontendUrl).toBe('https://web.example.test');
  });

  it('lokální vývoj: pohodlné localhost výchozí hodnoty zůstávají', () => {
    expect(odvodPresmerovani({ NODE_ENV: 'development' })).toEqual({
      publicUrl: 'http://localhost:3001',
      frontendUrl: 'http://localhost:5173',
      allowedRedirectUris: ['http://localhost:5173', 'http://localhost:8100'],
    });
  });
});
