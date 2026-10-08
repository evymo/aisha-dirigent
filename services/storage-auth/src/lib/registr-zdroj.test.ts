import { describe, it, expect } from 'vitest';
import { vytvorStahovani } from './registr-zdroj.js';

const REGISTR = 'https://repo.example.test';
type Volani = { url: string; auth: string | null };

/**
 * Falešný fetch: podle mapy URL → odpověď, a zapisuje, kam šel token.
 *
 * ⛔ Chová se jako NEJHORŠÍ knihovna: dostane-li `redirect` jiné než 'manual',
 *    přesměrování následuje SAMA a přenese stejné hlavičky. Kdyby kód přesměrování
 *    přenechal knihovně, test uvidí token na cizím původu (mutace A2 z revize).
 */
function sit(odpovedi: Record<string, { status: number; location?: string; telo?: string }>) {
  const volani: Volani[] = [];
  const f = (async (input: URL | string, init?: RequestInit) => {
    let url = input.toString();
    const h = (init?.headers ?? {}) as Record<string, string>;
    for (let i = 0; i < 5; i++) {
      volani.push({ url, auth: h.Authorization ?? null });
      const o = odpovedi[url];
      if (!o) return new Response('nenalezeno', { status: 404 });
      if (init?.redirect !== 'manual' && o.status >= 300 && o.status < 400 && o.location) {
        url = new URL(o.location, url).toString();
        continue;
      }
      const headers = o.location ? { location: o.location } : undefined;
      return new Response(o.telo ?? null, { status: o.status, headers });
    }
    return new Response(null, { status: 508 });
  }) as unknown as typeof fetch;
  return { f, volani };
}

const cti = async (r: NodeJS.ReadableStream) => {
  const c: Buffer[] = [];
  for await (const x of r) c.push(Buffer.from(x as Buffer));
  return Buffer.concat(c).toString();
};

describe('stažení balíčku ze zdroje', () => {
  it('token jde na původ registru a obsah dorazí', async () => {
    const u = `${REGISTR}/api/packages/org/generic/kiosk/1.1.0-14/kiosk.apk`;
    const { f, volani } = sit({ [u]: { status: 200, telo: 'APK' } });
    const stahni = vytvorStahovani({ puvod: REGISTR, token: 'tajny', limitMs: 5000 }, f);
    expect(await cti(await stahni(u))).toBe('APK');
    expect(volani).toEqual([{ url: u, auth: 'token tajny' }]);
  });

  it('⛔ zdroj mimo registr se vůbec NESTAHUJE (adresa je z dat instance — ani token, ani slepý dotaz z naší sítě)', async () => {
    for (const cizi of ['https://jinde.example.test/kiosk.apk', 'https://169.254.169.254/latest/meta-data', 'https://localhost/x.apk']) {
      const { f, volani } = sit({ [cizi]: { status: 200, telo: 'APK' } });
      await expect(vytvorStahovani({ puvod: REGISTR, token: 'tajny', limitMs: 5000 }, f)(cizi)).rejects.toThrow(/není na registru/);
      expect(volani).toEqual([]);
    }
  });

  it('⛔ bez nastaveného původu registru se nestahuje nic (nejde ověřit, kam token smí)', async () => {
    const u = `${REGISTR}/x.apk`;
    const { f, volani } = sit({ [u]: { status: 200, telo: 'APK' } });
    await expect(vytvorStahovani({ puvod: '', token: 'tajny', limitMs: 5000 }, f)(u)).rejects.toThrow(/ZARIZENI_ZDROJ_PUVOD/);
    expect(volani).toEqual([]);
  });

  it('⛔ přesměrování na úložiště blobů jinde → další skok už BEZ tokenu', async () => {
    const u = `${REGISTR}/api/packages/org/generic/kiosk/1/kiosk.apk`;
    const blob = 'https://bloby.example.test/podepsana-adresa';
    const { f, volani } = sit({ [u]: { status: 302, location: blob }, [blob]: { status: 200, telo: 'APK' } });
    expect(await cti(await vytvorStahovani({ puvod: REGISTR, token: 'tajny', limitMs: 5000 }, f)(u))).toBe('APK');
    expect(volani).toEqual([{ url: u, auth: 'token tajny' }, { url: blob, auth: null }]);
  });

  it('⛔ přesměrování z registru na http se NESTÁHNE (balíček by šel nešifrovaně)', async () => {
    const u = `${REGISTR}/api/packages/org/generic/kiosk/1/kiosk.apk`;
    const nesifrovane = 'http://bloby.example.test/kiosk.apk';
    const { f, volani } = sit({ [u]: { status: 302, location: nesifrovane }, [nesifrovane]: { status: 200, telo: 'APK' } });
    await expect(vytvorStahovani({ puvod: REGISTR, token: 'tajny', limitMs: 5000 }, f)(u)).rejects.toThrow(/https/);
    expect(volani.map((v) => v.url)).toEqual([u]);
  });

  it('⛔ ne-https, chybová odpověď i nekonečné přesměrování = chyba, ne tichý prázdný soubor', async () => {
    const stahni = (s: ReturnType<typeof sit>) => vytvorStahovani({ puvod: REGISTR, token: 't', limitMs: 5000 }, s.f);
    await expect(stahni(sit({}))('http://repo.example.test/x.apk')).rejects.toThrow(/https|není na registru/);
    const u = `${REGISTR}/x.apk`;
    await expect(stahni(sit({ [u]: { status: 401 } }))(u)).rejects.toThrow(/401/);
    await expect(stahni(sit({ [u]: { status: 302, location: u } }))(u)).rejects.toThrow(/přesměroval/);
  });
});
