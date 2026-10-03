/**
 * Dnešní rozvozy na TABLETU (F2) — čisté jádro obrazovky `/kiosk`.
 *
 * Server (`get_kiosk_rozvozy`) vrací jen to, co tablet vidět smí: kroky, které pokrývá
 * rozsah instance, a z nich jen povolená pole (bez osobních údajů odběratele). Tady se
 * odpověď jen OVĚŘÍ a převede do tvaru obrazovky — nic se nedopočítává ani nefiltruje,
 * aby klient nemohl předstírat jiný pohled než ten, který rozhodl server.
 */
import type { TapeItem } from "@/extranet/arrange";

export type RezimVyberu = "ridic" | "vozidlo";

export interface PolozkaNabidky {
  hodnota: string;
  kPredani: number;
  hotovo: number;
}

export interface Nabidka {
  ridici: PolozkaNabidky[];
  vozidla: PolozkaNabidky[];
}

export interface Rozvoz {
  id: string;
  hotovo: boolean;
  /**
   * Odběratel, KTERÉMU náš řidič náklad veze (majitel 2026-09-29: „jen odběratele, kterému
   * vezou naši řidiči náklad“) — cíl rozvozu, ne kontakt. Jen je-li v povolených polích.
   */
  odberatel: string | null;
  /** Číslo dodacího listu (je-li v povolených polích). */
  doklad: string | null;
  kam: string | null;
  ridic: string | null;
  vozidlo: string | null;
}

const cislo = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const text = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);

function polozky(x: unknown): PolozkaNabidky[] {
  if (!Array.isArray(x)) return [];
  return x.flatMap((p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    const hodnota = text(o.hodnota);
    return hodnota ? [{ hodnota, kPredani: cislo(o.k_predani), hotovo: cislo(o.hotovo) }] : [];
  });
}

/** Chyba serveru (`{ok:false,error}`) se hlásí, ne mlčky převádí na prázdný seznam. */
export class ChybaRozvozu extends Error {
  constructor(public readonly kod: string) {
    super(`kiosk_rozvozy: ${kod}`);
  }
}

function overOk(data: unknown): Record<string, unknown> {
  const o = (data ?? {}) as Record<string, unknown>;
  if (o.ok !== true) throw new ChybaRozvozu(text(o.error) ?? "neznama_odpoved");
  return o;
}

export function rozlozNabidku(data: unknown): Nabidka {
  const o = overOk(data);
  return { ridici: polozky(o.ridici), vozidla: polozky(o.vozidla) };
}

export function rozlozRozvozy(data: unknown): Rozvoz[] {
  const o = overOk(data);
  if (!Array.isArray(o.rozvozy)) return [];
  return o.rozvozy.flatMap((r) => {
    const x = (r ?? {}) as Record<string, unknown>;
    const id = text(x.id);
    if (!id) return [];
    const pole = (x.pole ?? {}) as Record<string, unknown>;
    return [{
      id,
      hotovo: x.stav === "completed",
      odberatel: text(pole.counterparty),
      doklad: text(pole.dl_number),
      kam: text(pole.delivery_address),
      ridic: text(pole.driver_name),
      vozidlo: text(pole.vehicle_registration),
    }];
  });
}

/**
 * Rozvozy → položky pásky (táž páska jako na telefonu: karta TEĎ, kolej, hotové).
 *
 * ⭐ Telefon vs tablet „mělo by to být jedno" (majitel): řidič, který jezdí s telefonem
 *    i s tabletem, vidí tentýž tvar. Nadpis = odběratel, KTERÉMU se veze, citace = místo
 *    vykládky, chip = dodací list; druhý údaj je ten, který výběr NEZNÁ (u výběru podle
 *    řidiče vozidlo a naopak) — vybranou hodnotu by karta jen opakovala.
 * ⛔ Pořadí se neřadí — je serverové (jako u pásky).
 */
export function naPasku(rozvozy: readonly Rozvoz[], rezim: RezimVyberu): TapeItem[] {
  return rozvozy.map((r) => ({
    id: r.id,
    title: r.odberatel ?? r.doklad ?? "—",
    quote: r.kam,
    state: r.hotovo ? "human_confirmed" : "pending",
    fields: [
      { key: "doklad", label_key: "kiosk.doklad", value: r.doklad },
      rezim === "ridic"
        ? { key: "vozidlo", label_key: "kiosk.vozidlo", value: r.vozidlo }
        : { key: "ridic", label_key: "kiosk.ridic", value: r.ridic },
    ],
  }));
}

/** Výběr dne na tabletu (řidič / vozidlo) — přežije restart, ne půlnoc. */
export const KLIC_VYBERU = "aisha.kiosk.vyber.v1";

export interface VyberDne {
  den: string;
  rezim: RezimVyberu;
  hodnota: string;
}

/** Místní den `YYYY-MM-DD` — výběr platí jen pro dnešní rozvozy. */
export function dnesniDen(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Uložený výběr, jen je-li z DNEŠKA a platný. Včerejší řidič na tabletu, který
 * přejel do jiné soupravy, by jinak ráno otevřel cizí rozvozy.
 */
export function zParsujVyber(json: string | null, den: string): { rezim: RezimVyberu; hodnota: string } | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<VyberDne>;
    if (v.den !== den) return null;
    if (v.rezim !== "ridic" && v.rezim !== "vozidlo") return null;
    const hodnota = text(v.hodnota);
    return hodnota ? { rezim: v.rezim, hodnota } : null;
  } catch {
    return null;
  }
}
