/**
 * Kdo volá — JEN ze vstupu, nikdy z hlavičky nebo těla (pravidlo 0.5 jádra, I5).
 *
 * Identita = (lokální adresa VB, kam požadavek dorazil) × (vzdálená adresa).
 * Lokální adresa sama nestačí: Linux je „weak host“ a doručí paket z kontejneru
 * nájemce A i na adresu, kterou VB má v síti B, když si A přidá trasu přes svou
 * síť (agent meshe má NET_ADMIN). Proto musí vzdálená adresa ležet v ROZSAHU KLIENTŮ
 * TÉHOŽ nájemce, jinak VSTUP_NEZNAMY (podmínka Guru 2 a 3, MN1). Ne celá podsíť: její
 * brána (.1) je hostitel uzlu a adresa vstupu je VB sám (N1, čtení jádra 0c).
 *
 * Klíč se porovnává jako otisk sha256 v konstantním čase (timingSafeEqual).
 * Do logu jde nejvýš prvních 12 hex otisku (KJ3, D2).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Duvod } from '@aisha/accel-protokol';
import { ipVPodsiti, normalizujAdresu } from './sit-adresy.js';
import type { Najemce, Tabulka } from './tabulka.js';

export function urciNajemce(adresy: { lokalni?: string; vzdalena?: string }, t: Tabulka): Najemce | Duvod {
  const lokalni = normalizujAdresu(adresy.lokalni);
  const vzdalena = normalizujAdresu(adresy.vzdalena);
  if (!lokalni || !vzdalena) return 'VSTUP_NEZNAMY';
  const n = t.podleVstupIp.get(lokalni);
  if (!n || !ipVPodsiti(vzdalena, n.rozsahKlientu) || vzdalena === n.vstupIp) return 'VSTUP_NEZNAMY';
  if (n.vypnuto) return 'NAJEMCE_VYPNUT';
  return n;
}

export function otiskKlice(klic: string): Buffer {
  return createHash('sha256').update(klic, 'utf8').digest();
}

/** Krátký otisk do logu — nikdy klíč, nikdy celý otisk. */
export function kratkyOtisk(o: Buffer): string {
  return o.toString('hex').slice(0, 12);
}

export function overKlic(authorization: string | undefined, n: Najemce, t: Tabulka): 'OK' | Duvod {
  if (!authorization || !authorization.startsWith('Bearer ') || authorization.length <= 7) return 'KLIC_CHYBI';
  const o = otiskKlice(authorization.slice(7));
  // Všechny otisky nájemce projdeme vždy celé (bez předčasného konce) — čas nezávisí na tom, který sedí.
  let shoda = false;
  for (const x of n.otisky) shoda = timingSafeEqual(x, o) || shoda;
  if (shoda) return 'OK';
  return t.vsechnyOtisky.has(o.toString('hex')) ? 'KLIC_JINEHO_VSTUPU' : 'KLIC_NEPLATNY';
}
