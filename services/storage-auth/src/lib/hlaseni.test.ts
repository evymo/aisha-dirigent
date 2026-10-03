/**
 * Hlášení tabletu: projde jen přesný tvar, nic osobního ani navíc; čas je serveru.
 */
import { describe, it, expect } from 'vitest';
import { MAX_ZARIZENI, VadneHlaseni, klicHlaseni, prectiHlaseni, ulozitelne } from './hlaseni.js';

const PLATNE = {
  zarizeni: '0f8fad5b-d9cb-469f-a165-70867728950e',
  model: 'samsung SM-X110',
  android: '14 (34)',
  kioskAdmin: { versionName: '1.5.0', versionCode: 7 },
  appky: [{ balicek: 'cz.example.ridic', versionCode: 15 }],
  webview: 'com.google.android.webview 126.0.6478.110',
  rezim: 'kiosk',
  stav: '28.9. 02:14:03 cz.example.ridic: nainstalováno.',
};

describe('hlášení tabletu', () => {
  it('platné hlášení projde beze změny tvaru', () => {
    expect(prectiHlaseni(PLATNE)).toEqual(PLATNE);
  });

  it('nenainstalovaný balíček je -1 a chybějící WebView null', () => {
    const h = prectiHlaseni({ ...PLATNE, appky: [{ balicek: 'cz.example.ridic', versionCode: -1 }], webview: null });
    expect(h.appky[0].versionCode).toBe(-1);
    expect(h.webview).toBeNull();
  });

  it.each([
    ['klíč navíc (nic osobního ani tajného neprojde)', { ...PLATNE, email: 'x@y.cz' }],
    ['id není uuid', { ...PLATNE, zarizeni: '../../zadosti/x' }],
    ['balíček není jméno balíčku', { ...PLATNE, appky: [{ balicek: 'cz/../x', versionCode: 1 }] }],
    ['verze není celé číslo', { ...PLATNE, kioskAdmin: { versionName: '1', versionCode: 1.5 } }],
    ['neznámý režim', { ...PLATNE, rezim: 'root' }],
    ['řídicí znaky ve stavu', { ...PLATNE, stav: 'a\nb' }],
    ['příliš dlouhý stav', { ...PLATNE, stav: 'x'.repeat(301) }],
    ['příliš mnoho appek', { ...PLATNE, appky: Array.from({ length: 11 }, () => ({ balicek: 'a.b', versionCode: 1 })) }],
  ])('⛔ %s → odmítnuto celé', (_n, telo) => {
    expect(() => prectiHlaseni(telo)).toThrow(VadneHlaseni);
  });

  it('klíč objektu je jen z uuid — cestu z těla nepostaví', () => {
    expect(klicHlaseni(prectiHlaseni(PLATNE).zarizeni)).toBe('hlaseni/0f8fad5b-d9cb-469f-a165-70867728950e.json');
  });

  it('čas přijetí je serveru a „poprvé" se drží přes další hlášení', () => {
    const h = prectiHlaseni(PLATNE);
    const prvni = ulozitelne(h, null, new Date('2026-09-28T02:00:00Z'));
    expect(prvni).toMatchObject({ prijato: '2026-09-28T02:00:00.000Z', prvni: '2026-09-28T02:00:00.000Z' });
    const druhe = ulozitelne(h, prvni, new Date('2026-09-29T02:00:00Z'));
    expect(druhe).toMatchObject({ prijato: '2026-09-29T02:00:00.000Z', prvni: '2026-09-28T02:00:00.000Z' });
  });

  it('strop zařízení je rozumný pro flotilu, ale konečný', () => {
    expect(MAX_ZARIZENI).toBeGreaterThanOrEqual(100);
    expect(MAX_ZARIZENI).toBeLessThanOrEqual(5000);
  });
});
