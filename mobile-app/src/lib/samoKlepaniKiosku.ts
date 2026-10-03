/**
 * Samo-klepání TABLETU v kiosku — dveře drží otevřené bez člověka.
 *
 * ⭐ ZADÁNÍ MAJITELE (2026-09-28): „autorizované zařízení musí umět zaklepat;
 * připojuje se jen přes LTE, je to hlídaný tablet" a „to zařízení samozřejmě
 * musí umět samo klepat, když je schválené".
 *
 * Telefon řidiče klepe reaktivně (`obsluhaDveri.ts`: jednou za pokus, pak
 * člověk). Tablet u rampy nikoho nemá — slepá ulička „zadejte kód" by znamenala
 * stojící předání. Proto tady:
 *
 *   · HLÍDÁ PROAKTIVNĚ: zkusí dosáhnout na server; když je zavřeno, zaťuká.
 *   · ⚠️ UDP: DÁVKA, NE JEDEN RÁMEC. Datagram po LTE se může ztratit a nikdo
 *     to nepozná (dveře mlčí vždy). Posílají se tři rámce, KAŽDÝ s vlastním
 *     nonce (jinak by druhý dveře zahodily jako replay), s mezerou, a pak se
 *     ověří dosažitelnost.
 *   · NEZAVŘE SE MU TO POD RUKAMA: nájem adresy dveří vyprší (SPA_PINHOLE_TTL);
 *     dokud tablet nemá relaci, která nájem prodlužuje, zaťuká preventivně
 *     i při otevřených dveřích, když od posledního zaťukání uběhlo 40 minut.
 *   · NEÚSPĚCH = DALŠÍ POKUS S ODSTUPEM, ne předání člověku. Adresa se na LTE
 *     mění; to, že teď neprošlo, neříká, že neprojde za minutu.
 *
 * ⛔ BEZ PRŮKAZU NEKLEPE A NIC NEZAKLÁDÁ. Průkaz vzniká jen lidským úkonem
 * (zavedení po zaťukání technika) — automatika ho jen ČTE (`nactiPovereni`).
 *
 * ⭐ ČISTÉ JÁDRO: čas, síť i klepání přicházejí parametrem.
 */
import type { KnockResult } from "./knock";
import type { PovereniZarizeni } from "./poverovani-zarizeni";

export const DAVKA = 3;
export const MEZERA_MS = 400;
export const OVERENI_PO_MS = 1_500;
/** Jak často se tablet dívá, jestli má otevřeno. */
export const HLIDKA_MS = 5 * 60_000;
/** Preventivní zaťukání — s rezervou pod nájmem dveří (3 600 s). */
export const PREVENCE_MS = 40 * 60_000;
const ODSTUP_START_MS = 30_000;

export type VysledekKola =
  /** Dosažitelné a nájem je čerstvý — nic se neposílalo. */
  | { vysledek: "otevreno" }
  /** Zaťukáno (zavřeno, nebo preventivně) a ověřeno, že je otevřeno. */
  | { vysledek: "zatukano"; kid: string }
  /** Zaťukáno, a pořád zavřeno. */
  | { vysledek: "zavreno"; kid: string; chyba?: string }
  /** Tablet průkaz nemá — tady není co dělat, zavádí člověk. */
  | { vysledek: "bez-prukazu" }
  | { vysledek: "chyba"; duvod: string };

export interface SamoKlepaniDeps {
  dosazitelne: () => Promise<boolean>;
  /** Jen ČTE. `null` = průkaz není. */
  nactiPovereni: () => Promise<PovereniZarizeni | null>;
  /** Jeden VER 2 rámec s novým nonce. */
  zatukej: (p: PovereniZarizeni) => Promise<KnockResult>;
  pockej: (ms: number) => Promise<void>;
  ted: () => number;
}

export interface PametKiosku {
  /** Kdy naposledy odešla dávka (ms), `null` = zatím nikdy. */
  posledniDavka: number | null;
  /** Kolik kol po sobě skončilo `zavreno` — určuje odstup. */
  neuspechuVRade: number;
}

export function novaPametKiosku(): PametKiosku {
  return { neuspechuVRade: 0, posledniDavka: null };
}

async function davka(p: PovereniZarizeni, deps: SamoKlepaniDeps): Promise<string | undefined> {
  let posledniChyba: string | undefined;
  let odeslano = 0;
  for (let i = 0; i < DAVKA; i++) {
    const r = await deps.zatukej(p);
    if (r.sent) odeslano += 1;
    else posledniChyba = r.error;
    if (i < DAVKA - 1) await deps.pockej(MEZERA_MS);
  }
  return odeslano > 0 ? undefined : posledniChyba ?? "žádný rámec neodešel";
}

/** Jedno kolo hlídky. Nikdy nevyhazuje — výsledek je stav, ne výjimka. */
export async function koloHlidky(pamet: PametKiosku, deps: SamoKlepaniDeps): Promise<VysledekKola> {
  try {
    const otevreno = await deps.dosazitelne();
    const cerstve = pamet.posledniDavka !== null && deps.ted() - pamet.posledniDavka < PREVENCE_MS;
    if (otevreno && cerstve) {
      pamet.neuspechuVRade = 0;
      return { vysledek: "otevreno" };
    }

    const p = await deps.nactiPovereni();
    if (p === null) return { vysledek: otevreno ? "otevreno" : "bez-prukazu" };

    const chyba = await davka(p, deps);
    pamet.posledniDavka = deps.ted();
    await deps.pockej(OVERENI_PO_MS);

    if (await deps.dosazitelne()) {
      pamet.neuspechuVRade = 0;
      return { kid: p.kid, vysledek: "zatukano" };
    }
    pamet.neuspechuVRade += 1;
    return { chyba, kid: p.kid, vysledek: "zavreno" };
  } catch (e) {
    return { duvod: e instanceof Error ? e.message : String(e), vysledek: "chyba" };
  }
}

/**
 * Za jak dlouho další kolo. Hlídka nekončí ani bez průkazu: po zavedení
 * technikem má naběhnout sama, bez restartu appky.
 *
 * ⛔ ODSTUP I KVŮLI OCHRANĚ DVEŘÍ. Neschválený tablet posílá rámce, které dveře
 * počítají jako neplatné (SPA_MAX_INVALID 10 / 60 s → cooldown adresy). Dávka 3
 * a odstup od 30 s drží tablet pod limitem, takže si nezablokuje ruční zaťukání
 * technika ze stejné adresy.
 */
export function dalsiKoloZa(v: VysledekKola, pamet: PametKiosku): number {
  if (v.vysledek === "zavreno") {
    return Math.min(ODSTUP_START_MS * 2 ** Math.max(0, pamet.neuspechuVRade - 1), HLIDKA_MS);
  }
  return HLIDKA_MS;
}
