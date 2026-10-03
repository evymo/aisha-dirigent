import { describe, it, expect } from 'vitest';
import { DeklaraceNedostupna, deklaraceZDb } from './zdroj-deklarace.js';

const OTISK = '4B:6E:9C:3E:90:DE:2B:9D:BF:76:5D:B2:B2:8F:B2:A7:20:5A:FB:23:B3:93:EA:5E:AC:13:5C:7F:BE:8A:28:00';
/** Doslovný `zarizeni/hlidac.json`, jak ho hák zapíše do DB. */
const SUROVA = {
  applicationId: 'com.example.hlidac', kiosk: { package: 'com.example.kiosk' }, signing: { certSha256: OTISK.toLowerCase() },
  versionName: '1.0.0', versionCode: 3, apk: { sha256: 'B'.repeat(64) },
  appky: [{ balicek: 'com.example.kiosk', versionCode: 14, versionName: '1.1.0', sha256: 'A'.repeat(64), velikostBajtu: 5 }],
  provisioning: { timeZone: 'Europe/Prague', locale: 'cs_CZ' },
};

function rpc(odpoved: { status: number; telo?: unknown } | Error) {
  const volani: { url: string; auth: string | null }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    volani.push({ url, auth: (init?.headers as Record<string, string>)?.Authorization ?? null });
    if (odpoved instanceof Error) throw odpoved;
    return new Response(odpoved.telo === undefined ? 'nic' : JSON.stringify(odpoved.telo), { status: odpoved.status });
  }) as unknown as typeof fetch;
  return { f, volani };
}
const db = (r: ReturnType<typeof rpc>) => deklaraceZDb({ postgrestUrl: 'http://postgrest.test', token: 'sluzba', f: r.f });

describe('deklarace zařízení z databáze', () => {
  it('RPC vrátí doslovný hlidac.json → normalizovaná deklarace (servisní token, správná RPC)', async () => {
    const r = rpc({ status: 200, telo: { deklarace: SUROVA, commit: 'abc123', zapsano: '2026-09-24T20:00:00Z' } });
    const s = await db(r).nacti();
    expect(s).toMatchObject({
      zapnuto: true,
      hlidac: {
        applicationId: 'com.example.hlidac', kioskPackage: 'com.example.kiosk', certSha256: OTISK,
        apkSha256: 'b'.repeat(64), timeZone: 'Europe/Prague', locale: 'cs_CZ',
        appky: [{ balicek: 'com.example.kiosk', versionCode: 14, sha256: 'a'.repeat(64) }],
      },
    });
    expect(r.volani).toEqual([{ url: 'http://postgrest.test/rpc/zarizeni_deklarace_cteni', auth: 'Bearer sluzba' }]);
  });

  it('RPC vrátí NULL → instance nic nedeklarovala (vypnuto, ne chyba)', async () => {
    expect(await db(rpc({ status: 200, telo: null })).nacti()).toEqual({ zapnuto: false });
  });

  it('vadná deklarace v DB → vypnuto S DŮVODEM, jako z env', async () => {
    const s = await db(rpc({ status: 200, telo: { deklarace: { ...SUROVA, signing: { certSha256: 'abc' } } } })).nacti();
    expect(s).toMatchObject({ zapnuto: false, chyba: /certSha256/ });
  });

  it('⛔ RPC neodpoví / vrátí chybu / chybí token → NEDOSTUPNÁ, nikdy „vypnuto" ani stará pravda', async () => {
    await expect(db(rpc(new Error('ECONNREFUSED'))).nacti()).rejects.toBeInstanceOf(DeklaraceNedostupna);
    await expect(db(rpc({ status: 500, telo: { message: 'x' } })).nacti()).rejects.toThrow(/500/);
    await expect(db(rpc({ status: 200 })).nacti()).rejects.toThrow(/JSON/);
    const bezTokenu = deklaraceZDb({ postgrestUrl: 'http://postgrest.test', token: '', f: rpc({ status: 200, telo: null }).f });
    await expect(bezTokenu.nacti()).rejects.toBeInstanceOf(DeklaraceNedostupna);
  });

});
