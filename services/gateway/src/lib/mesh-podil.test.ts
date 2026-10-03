import { describe, expect, it } from 'vitest';
import { parseTrusted } from '@aisha/knock-protocol';
import { jePeerAdresa, maMeshPodil } from './mesh-podil.js';

// ⭐ Seznamy jdou do stráže PŘES SKUTEČNÝ PARSER, ne jako ručně psané řetězce.
// `maMeshPodil` se ptá tvaru, podle kterého se u dveří rozhoduje, a `parseTrusted`
// vadné položky tiše zahazuje — test, který parser obejde, by měřil jiný svět.
const jako = (polozky: readonly string[]) => maMeshPodil(parseTrusted(polozky));

// Přesně to, co je NASAZENO v <fork>-edge (Coolify, 2026-09-02).
const NASAZENO = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.1', '100.64.0.0/10'];
// Tvar, který vydá `gatewayTrustedProxies('100.126.250.10')`.
const PO_OPRAVE = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.1', '100.126.250.10'];

describe('mesh podíl v seznamu proxy', () => {
  it('nasazený seznam mesh peera NEMÁ — a právě to je ta tichá porucha', () => {
    expect(jako(NASAZENO)).toBe(false);
  });

  it('po opravě ho má', () => {
    expect(jako(PO_OPRAVE)).toBe(true);
  });

  // ⛔ Regrese na první, MRTVOU verzi téhle stráže: ta se ptala jen „položka bez
  // lomítka", takže ji `127.0.0.1` uspokojil vždycky a nikdy nespustila.
  it('samotný loopback mesh podíl NETVOŘÍ', () => {
    expect(jako(['127.0.0.1'])).toBe(false);
    expect(jako(['::1'])).toBe(false);
    expect(jako(['10.0.0.0/8', '127.0.0.1'])).toBe(false);
    expect(jePeerAdresa('127.0.0.1')).toBe(false);
  });

  it('prázdný seznam nemá podíl (a hlídá ho i druhá stráž)', () => {
    expect(jako([])).toBe(false);
  });

  it('rozsah není adresa peera', () => {
    expect(jePeerAdresa('100.64.0.0/10')).toBe(false);
    expect(jePeerAdresa('10.0.0.0/8')).toBe(false);
  });

  it('adresa peera se pozná i s okrajovými mezerami', () => {
    expect(jePeerAdresa('  100.126.250.10  ')).toBe(true);
  });

  it('prázdná položka se nepočítá jako peer', () => {
    expect(jePeerAdresa('')).toBe(false);
    expect(jePeerAdresa('   ')).toBe(false);
  });
});
