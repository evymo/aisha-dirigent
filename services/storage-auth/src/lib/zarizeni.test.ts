import { describe, it, expect } from 'vitest';
import { overZarizeni, zeSuroveDeklarace, checksumQr, klicApk, klicAppky } from './zarizeni.js';

const OTISK = '4B:6E:9C:3E:90:DE:2B:9D:BF:76:5D:B2:B2:8F:B2:A7:20:5A:FB:23:B3:93:EA:5E:AC:13:5C:7F:BE:8A:28:00';
const IDENTITA = {
  applicationId: 'com.example.hlidac', kioskPackage: 'com.example.kiosk', certSha256: OTISK,
  versionName: '1.0.0', versionCode: 1, timeZone: 'Europe/Prague', locale: 'cs_CZ',
};

describe('schopnost zařízení', () => {
  it('bez deklarace (databáze vrátí NULL) je vypnutá a nic nevymýšlí', () => {
    expect(zeSuroveDeklarace(null)).toEqual({ zapnuto: false });
    expect(zeSuroveDeklarace(undefined)).toEqual({ zapnuto: false });
  });

  it('platná identita ji zapne', () => {
    const s = overZarizeni(IDENTITA);
    expect(s.zapnuto).toBe(true);
    if (s.zapnuto) expect(s.hlidac).toEqual(IDENTITA);
  });

  it('vadná identita ji vypne S DŮVODEM', () => {
    expect(zeSuroveDeklarace('nic')).toMatchObject({ zapnuto: false, chyba: expect.any(String) });
    expect(overZarizeni({ ...IDENTITA, certSha256: 'abc' })).toMatchObject({ zapnuto: false, chyba: /certSha256/ });
    expect(overZarizeni({ ...IDENTITA, kioskPackage: 'Bez.Tecky x' })).toMatchObject({ zapnuto: false, chyba: /kioskPackage/ });
    expect(overZarizeni({ ...IDENTITA, versionCode: 0 })).toMatchObject({ zapnuto: false, chyba: /versionCode/ });
  });

  it('`zdroj` balíčku (appky i Kiosk Admin) se převezme, jen https bez údajů v adrese', () => {
    const appka = { balicek: 'com.example.kiosk', versionCode: 14, versionName: '1.1.0', sha256: 'a'.repeat(64) };
    const zdroj = 'https://registr.example.test/api/packages/org/generic/kiosk/1.1.0-14/kiosk.apk';
    const ok = overZarizeni({ ...IDENTITA, apk: { sha256: 'b'.repeat(64), zdroj }, appky: [{ ...appka, zdroj }] });
    expect(ok).toMatchObject({ zapnuto: true, hlidac: { apkZdroj: zdroj, appky: [{ zdroj }] } });
    // Bez zdroje zůstává deklarace platná — jen se bude nahrávat ručně.
    expect(overZarizeni({ ...IDENTITA, appky: [appka] })).toMatchObject({ zapnuto: true });
    for (const spatny of ['http://registr.example.test/x.apk', 'https://jmeno:heslo@registr.example.test/x.apk', 'ne-adresa']) {
      expect(overZarizeni({ ...IDENTITA, appky: [{ ...appka, zdroj: spatny }] }))
        .toMatchObject({ zapnuto: false, chyba: /zdroj/ });
      expect(overZarizeni({ ...IDENTITA, apk: { sha256: 'b'.repeat(64), zdroj: spatny } }))
        .toMatchObject({ zapnuto: false, chyba: /apk\.zdroj/ });
    }
  });

  it('checksum pro QR = tentýž, jaký vyrábí apps/hlidac/scripts/qr.mjs', () => {
    expect(checksumQr(OTISK)).toBe('S26cPpDeK52_dl2yso-ypyBa-yOzk-perBNcf76KKAA');
  });

  it('APK leží pod jménem balíčku', () => {
    expect(klicApk(IDENTITA)).toBe('hlidac/com.example.hlidac.apk');
  });
});

describe('rozdávané appky v deklaraci', () => {
  const zaklad = {
    applicationId: 'cz.test.hlidac',
    kioskPackage: 'cz.test.ridic',
    certSha256: '4B:6E:9C:3E:90:DE:2B:9D:BF:76:5D:B2:B2:8F:B2:A7:20:5A:FB:23:B3:93:EA:5E:AC:13:5C:7F:BE:8A:28:00',
    versionName: '1.0.0',
    versionCode: 1,
  };
  const appka = { balicek: 'cz.test.ridic', versionCode: 42, versionName: '2.1.0', sha256: 'a'.repeat(64) };

  it('bez klíče `appky` zůstane schopnost zapnutá a seznam prázdný', () => {
    const stav = overZarizeni(zaklad);
    expect(stav.zapnuto).toBe(true);
    if (stav.zapnuto) expect(stav.hlidac.appky).toBeUndefined();
  });

  it('platný seznam se přečte a otisk se znormalizuje na malá písmena', () => {
    const stav = overZarizeni({ ...zaklad, appky: [{ ...appka, sha256: 'A'.repeat(64) }] });
    expect(stav.zapnuto).toBe(true);
    if (stav.zapnuto) expect(stav.hlidac.appky).toEqual([{ ...appka, sha256: 'a'.repeat(64) }]);
  });

  it('⛔ vadná položka schopnost VYPNE S DŮVODEM, nepřeskočí se tiše', () => {
    // Tiché přeskočení by znamenalo tablet, který nikdy nedostane aktualizaci,
    // a administraci, která tvrdí, že je všechno v pořádku.
    for (const [zmena, ocekavano] of [
      [{ balicek: 'NEJMENO' }, /balicek/],
      [{ versionCode: 0 }, /versionCode/],
      [{ versionName: '' }, /versionName/],
      [{ sha256: 'krátký' }, /sha256/],
    ] as const) {
      const stav = overZarizeni({ ...zaklad, appky: [{ ...appka, ...zmena }] });
      expect(stav.zapnuto).toBe(false);
      if (!stav.zapnuto) expect(stav.chyba).toMatch(ocekavano);
    }
  });

  it('`appky` musí být seznam, ne objekt', () => {
    const stav = overZarizeni({ ...zaklad, appky: { balicek: 'cz.test.ridic' } });
    expect(stav.zapnuto).toBe(false);
  });

  it('kontrolní vzorek: klíč objektu se skládá z jména balíčku', () => {
    expect(klicAppky('cz.test.ridic')).toBe('appky/cz.test.ridic.apk');
  });
});
