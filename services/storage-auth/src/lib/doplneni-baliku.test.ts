import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { doplnBalik, type DoplneniZavislosti } from './doplneni-baliku.js';

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const APK = Buffer.concat([ZIP, Buffer.from('obsah-balicku-1.1.0-14')]);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const KLIC = 'appky/com.example.kiosk.apk';
const ZDROJ = 'https://registr.example.test/api/packages/org/generic/kiosk/1.1.0-14/kiosk.apk';

/** Úložiště v paměti: klíč → otisk + obsah, a záznam, co se stahovalo. */
function svet(vUlozisti: string | null, zeZdroje: Buffer | Error = APK) {
  const ulozeno: { klic: string; obsah: Buffer; bajtu: number; sha256: string }[] = [];
  const stazeno: string[] = [];
  const z: DoplneniZavislosti = {
    uloziste: { otisk: async () => vUlozisti },
    stahni: async (url) => {
      stazeno.push(url);
      if (zeZdroje instanceof Error) throw zeZdroje;
      return Readable.from([zeZdroje]);
    },
    uloz: async (klic, soubor, bajtu, sha256) => {
      ulozeno.push({ klic, obsah: await readFile(soubor), bajtu, sha256 });
    },
    maxBajtu: 1024,
  };
  return { z, ulozeno, stazeno };
}

describe('doplnění balíčku do úložiště z deklarovaného zdroje', () => {
  it('úložiště drží deklarovaný balíček → nic se nestahuje', async () => {
    const s = svet(sha(APK));
    expect(await doplnBalik({ klic: KLIC, ocekavanySha256: sha(APK), zdroj: ZDROJ }, s.z)).toEqual({ stav: 'drzi', klic: KLIC });
    expect(s.stazeno).toEqual([]);
  });

  it('balíček chybí → stáhne se, ověří otiskem a uloží i s otiskem', async () => {
    const s = svet(null);
    expect(await doplnBalik({ klic: KLIC, ocekavanySha256: sha(APK), zdroj: ZDROJ }, s.z))
      .toEqual({ stav: 'doplneno', klic: KLIC, bajtu: APK.length });
    expect(s.ulozeno).toEqual([{ klic: KLIC, obsah: APK, bajtu: APK.length, sha256: sha(APK) }]);
  });

  it('v úložišti leží STARÁ verze → nahradí se deklarovanou (stav naměřený 2026-09-24)', async () => {
    const s = svet('c'.repeat(64));
    expect((await doplnBalik({ klic: KLIC, ocekavanySha256: sha(APK), zdroj: ZDROJ }, s.z)).stav).toBe('doplneno');
    expect(s.ulozeno[0].sha256).toBe(sha(APK));
  });

  it('⛔ zdroj pošle JINÝ obsah, než deklarace slibuje → úložiště beze změny', async () => {
    const jiny = Buffer.concat([ZIP, Buffer.from('podvrh')]);
    const s = svet(null, jiny);
    expect(await doplnBalik({ klic: KLIC, ocekavanySha256: sha(APK), zdroj: ZDROJ }, s.z))
      .toEqual({ stav: 'zdroj_nesedi', klic: KLIC, deklarovano: sha(APK), stazeno: sha(jiny) });
    expect(s.ulozeno).toEqual([]);
  });

  it('⛔ bez zdroje se nic nevymýšlí — řekne se, co chybí', async () => {
    const s = svet(null);
    expect(await doplnBalik({ klic: KLIC, ocekavanySha256: sha(APK) }, s.z))
      .toEqual({ stav: 'bez_zdroje', klic: KLIC, porucha: 'chybi' });
    expect(s.stazeno).toEqual([]);
  });

  it('⛔ zdroj nedostupný / přes strop / ne-APK → selhání, úložiště beze změny', async () => {
    const nedostupny = svet(null, new Error('zdroj https://registr.example.test/x vrátil 401'));
    expect(await doplnBalik({ klic: KLIC, ocekavanySha256: sha(APK), zdroj: ZDROJ }, nedostupny.z))
      .toMatchObject({ stav: 'zdroj_selhal', duvod: /401/ });
    const velky = svet(null, Buffer.concat([ZIP, Buffer.alloc(2048)]));
    expect(await doplnBalik({ klic: KLIC, ocekavanySha256: sha(APK), zdroj: ZDROJ }, velky.z))
      .toMatchObject({ stav: 'zdroj_selhal', duvod: /1024/ });
    const html = svet(null, Buffer.from('<html>přihlaste se</html>'));
    expect(await doplnBalik({ klic: KLIC, ocekavanySha256: sha(APK), zdroj: ZDROJ }, html.z))
      .toMatchObject({ stav: 'zdroj_selhal', duvod: /ZIP/ });
    for (const s of [nedostupny, velky, html]) expect(s.ulozeno).toEqual([]);
  });

  it('bez otisku v deklaraci se nic neověřuje ani nedoplňuje', async () => {
    const s = svet(null);
    expect(await doplnBalik({ klic: KLIC, ocekavanySha256: '', zdroj: ZDROJ }, s.z)).toEqual({ stav: 'nedeklarovano' });
    expect(s.stazeno).toEqual([]);
  });
});
