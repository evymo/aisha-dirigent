/**
 * Žádosti o nastavení tabletu — co administrace vyrobila do QR, aby se dalo
 * vzít jako vzor pro další tablet.
 *
 * ⛔ PROČ TO VZNIKLO (2026-09-22). QR žil jen ve stavu prohlížeče a po čase
 * zmizel. Technik ho pak vyráběl znovu a pokaždé znovu psal heslo k Wi-Fi —
 * jeden překlep a tablet se na síť nedostane, což Android hlásí jen jako
 * „Nastavení se nezdařilo". Nic z toho se nedalo dohledat.
 *
 * ⛔ TAJEMSTVÍ SE NEUKLÁDAJÍ — ani heslo k Wi-Fi, ani PIN, ani jeho otisk.
 *   Tělo, které cokoli z toho nese, se ODMÍTNE celé (ne tiše ořízne: odesílatel
 *   by věřil, že je uložené). Otisk PINu záměrně taky ne: 6místný PIN se
 *   z PBKDF2 otisku hrubou silou zjistí na GPU za minuty, a PIN je jediná cesta
 *   z kiosku ven. Předloha nese NASTAVENÍ; tajemství technik zadá znovu.
 *
 * ⭐ Verzi a otisk hlídače razítkuje SERVER z deklarace instance, ne prohlížeč:
 *    „z jaké verze tahle žádost je" je fakt serveru, ne tvrzení klienta.
 */
import { randomUUID } from 'node:crypto';

export type Zabezpeceni = 'WPA' | 'WEP' | 'NONE';

export interface VstupZadosti {
  poznamka: string | null;
  sit: { ssid: string; zabezpeceni: Zabezpeceni } | null;
  okno: string;
}

export interface ZadostHlidace extends VstupZadosti {
  id: string;
  vytvoreno: string;
  autor: string;
  hlidac: { versionCode: number; checksum: string };
}

export const PREFIX_ZADOSTI = 'zadosti/';
export const MAX_POZNAMKA = 200;
export const MAX_VYPIS = 50;

const OKNO = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
const ZABEZPECENI: readonly Zabezpeceni[] = ['WPA', 'WEP', 'NONE'];

export class VadnaZadost extends Error {}

function jenKlice(o: Record<string, unknown>, povolene: readonly string[], kde: string): void {
  for (const k of Object.keys(o)) {
    if (!povolene.includes(k)) throw new VadnaZadost(`${kde}: nepovolený klíč „${k}"`);
  }
}

function jeObjekt(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Ověří tělo od administrace. Cokoli navíc je vada, ne šum k zahození. */
export function prectiVstup(telo: unknown): VstupZadosti {
  if (!jeObjekt(telo)) throw new VadnaZadost('tělo musí být objekt');
  // ⛔ `pinZaznam`, `pin`, `heslo` tu končí jako nepovolený klíč.
  jenKlice(telo, ['poznamka', 'sit', 'okno'], 'žádost');

  const { poznamka, sit, okno } = telo;

  if (poznamka !== undefined && poznamka !== null && typeof poznamka !== 'string') {
    throw new VadnaZadost('poznamka musí být text');
  }
  const pozn = typeof poznamka === 'string' ? poznamka.trim() : '';
  if (pozn.length > MAX_POZNAMKA) throw new VadnaZadost(`poznamka je delší než ${MAX_POZNAMKA} znaků`);

  if (typeof okno !== 'string' || !OKNO.test(okno)) throw new VadnaZadost('okno musí mít tvar HH:MM-HH:MM');

  let sitOk: VstupZadosti['sit'] = null;
  if (sit !== undefined && sit !== null) {
    if (!jeObjekt(sit)) throw new VadnaZadost('sit musí být objekt');
    // ⛔ `heslo` tady končí jako nepovolený klíč — záměrně celé tělo, ne ořez.
    jenKlice(sit, ['ssid', 'zabezpeceni'], 'sit');
    if (typeof sit.ssid !== 'string' || !sit.ssid.trim() || sit.ssid.length > 32) {
      throw new VadnaZadost('sit.ssid musí být 1–32 znaků');
    }
    const z = sit.zabezpeceni ?? 'WPA';
    if (!ZABEZPECENI.includes(z as Zabezpeceni)) throw new VadnaZadost('sit.zabezpeceni musí být WPA, WEP nebo NONE');
    sitOk = { ssid: sit.ssid, zabezpeceni: z as Zabezpeceni };
  }

  return { poznamka: pozn || null, sit: sitOk, okno };
}

/** Klíč objektu: čas vpředu, aby se výpis řadil podle jména bez čtení obsahu. */
export function klicZadosti(vytvoreno: string, id: string): string {
  return `${PREFIX_ZADOSTI}${vytvoreno.replace(/[:.]/g, '-')}_${id}.json`;
}

export function novaZadost(
  vstup: VstupZadosti,
  autor: string,
  hlidac: ZadostHlidace['hlidac'],
  ted: Date = new Date(),
  id: string = randomUUID(),
): ZadostHlidace {
  return { id, vytvoreno: ted.toISOString(), autor, hlidac, ...vstup };
}

/** Nejnovější první, nanejvýš `MAX_VYPIS`. */
export function nejnovejsi(klice: readonly string[]): string[] {
  return klice
    .filter((k) => k.startsWith(PREFIX_ZADOSTI) && k.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, MAX_VYPIS);
}
