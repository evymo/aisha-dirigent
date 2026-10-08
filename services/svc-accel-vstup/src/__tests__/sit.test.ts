// Podmínka Guru 1: ip_forward=0 (a spol.) ve jmenném prostoru VB se MĚŘÍ; odchylka = VB neslouží (MN3).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Kvoty, knihaVPameti } from '../kvoty.js';
import type { Pripravenost } from '../pripravenost.js';
import { vytvorVstup } from '../vstup.js';
import { POZADOVANE_SYSCTL, odchylkySite } from '../sit.js';
import { postavTabulku } from '../tabulka.js';
import { IP_Z, KLIC_Z, clenstviOk, uzel } from './fixtura.js';

const koreny: string[] = [];
function falesnyProc(hodnoty: Record<string, string | null>) {
  const k = mkdtempSync(join(tmpdir(), 'vb-proc-'));
  koreny.push(k);
  for (const [cesta, v] of Object.entries({ ...POZADOVANE_SYSCTL, ...hodnoty })) {
    if (v === null) continue;
    const f = join(k, 'sys', cesta);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, `${v}\n`);
  }
  return k;
}
afterAll(() => koreny.forEach((k) => rmSync(k, { recursive: true, force: true })));

describe('síť jmenného prostoru VB', () => {
  it('kotva: požadované hodnoty = žádná odchylka', () => {
    expect(odchylkySite(falesnyProc({}))).toEqual([]);
  });
  it('ip_forward=1 je odchylka; nečitelná hodnota taky (NEZMĚŘENO ≠ v pořádku)', () => {
    expect(odchylkySite(falesnyProc({ 'net/ipv4/ip_forward': '1' }))).toEqual(['net/ipv4/ip_forward=1 (požadováno 0)']);
    expect(odchylkySite(falesnyProc({ 'net/ipv4/conf/all/rp_filter': null }))).toEqual(['net/ipv4/conf/all/rp_filter: nejde přečíst']);
  });
  it('VB s odchylkou sítě neobsluhuje nikoho: LANE_NEDOSTUPNA i s platným klíčem (MN3)', async () => {
    const r = postavTabulku(uzel());
    if ('vady' in r) throw new Error();
    const app = vytvorVstup({
      tabulka: () => r.tabulka,
      pripravenost: { rozhodni: () => null } as unknown as Pripravenost,
      clenstvi: () => clenstviOk(),
      kvoty: new Kvoty(knihaVPameti()),
      upstream: { post: async () => ({ status: 200, telo: {} }) },
      adresy: () => ({ lokalni: IP_Z.vstup, vzdalena: IP_Z.klient }),
      sitOk: () => false,
    });
    const odp = await app.inject({ method: 'GET', url: '/v1/models', headers: { authorization: `Bearer ${KLIC_Z}` } });
    expect([odp.statusCode, odp.json().duvod]).toEqual([503, 'LANE_NEDOSTUPNA']);
  });
});
