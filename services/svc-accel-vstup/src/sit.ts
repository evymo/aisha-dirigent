/**
 * Síťová pravidla ve jmenném prostoru VB — MĚŘENÁ z /proc, ne předpokládaná
 * (podmínka Guru 1: lane mezi sítěmi nájemců nepřeposílá).
 *
 * VB visí na síti každého nájemce. Kdyby jeho jmenný prostor přeposílal pakety,
 * stal by se mostem mezi nájemci (A → adresa lane → B). Compose nastaví sysctl,
 * ale nastavení není měření: VB je čte při startu i za běhu a pokud nesedí,
 * NEOBSLUHUJE nikoho (LANE_NEDOSTUPNA) a zdraví je červené (MN3).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Požadované hodnoty: cesta pod /proc/sys → hodnota. */
export const POZADOVANE_SYSCTL: Readonly<Record<string, string>> = Object.freeze({
  'net/ipv4/ip_forward': '0',
  'net/ipv4/conf/all/rp_filter': '1',
  'net/ipv4/conf/all/arp_ignore': '1',
  'net/ipv4/conf/all/arp_announce': '2',
  'net/ipv6/conf/all/disable_ipv6': '1',
});

/** Odchylky od požadovaného stavu; nečitelná hodnota je odchylka (NEZMĚŘENO ≠ v pořádku). */
export function odchylkySite(procKoren = '/proc'): string[] {
  const out: string[] = [];
  for (const [cesta, chci] of Object.entries(POZADOVANE_SYSCTL)) {
    let je: string;
    try {
      je = readFileSync(join(procKoren, 'sys', cesta), 'utf8').trim();
    } catch {
      out.push(`${cesta}: nejde přečíst`);
      continue;
    }
    if (je !== chci) out.push(`${cesta}=${je} (požadováno ${chci})`);
  }
  return out;
}
