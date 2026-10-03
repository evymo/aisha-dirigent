/**
 * Poloha ZAŘÍZENÍ u potvrzení předání — metainformace, ne důkaz.
 *
 * ⭐ ROZHODNUTÍ MAJITELE (2026-09-18). Důkazní poloha předání se dál ODVOZUJE
 * na serveru (`workflow_step_derived_position`: signál příjezdu, telematika vozu)
 * a platí pravidlo z 2026-07-28: souřadnice od toho, koho záznam dokumentuje,
 * důkaz NENÍ. Poloha tabletu se proto ukládá VEDLE ní jako `device_geo` —
 * další metainformace, která zvyšuje důvěryhodnost záznamu v čase a místě
 * (shoda dvou nezávislých zdrojů), nikdy nenahrazuje tu odvozenou.
 *
 * ⛔ POLOHA NESMÍ ZASTAVIT PŘEDÁNÍ. Řidič potvrzuje v lomu, v garáži, pod
 * střechou — tam GPS nebývá. Chybějící poloha je CHYBĚJÍCÍ POZOROVÁNÍ, ne důvod
 * odmítnout práci; proto se nikdy nevyhazuje a místo ní se řekne proč
 * (`unavailable`), aby mezera byla poctivá, ne prázdná.
 *
 * Čistá logika bez nativních modulů — nativní adaptér je v `polohaZarizeni-native.ts`,
 * takže tentýž kód běží v testu i na tabletu.
 */
import { safeWarn } from "@/lib/security/safeLogger";

/** Proč poloha chybí. Uzavřená množina — server jinou hodnotu odmítne. */
export type DuvodBezPolohy = "denied" | "disabled" | "timeout" | "error";

export interface PolohaZarizeni {
  lat: number;
  lon: number;
  /** Poloměr nejistoty v metrech, jak ho hlásí zařízení; `null` = neuvedl. */
  accuracy_m: number | null;
  /** Kdy zařízení polohu naměřilo (ne kdy se potvrdilo). ISO 8601. */
  captured_at: string;
}

/** Tvar, který jde do evidence jako `device_position`. */
export type DevicePositionPayload = PolohaZarizeni | { unavailable: DuvodBezPolohy };

export interface NamerenaPoloha {
  lat: number;
  lon: number;
  accuracy: number | null;
  /** ms od epochy */
  timestamp: number;
}

export interface PolohaDeps {
  /** Má appka oprávnění? Smí se zeptat (na tabletu ho uděluje hlídač předem). */
  opravneni(): Promise<"granted" | "denied">;
  /** Jsou polohové služby zapnuté? */
  sluzbyZapnute(): Promise<boolean>;
  /** Čerstvé měření; `null` = nepřišlo. Nesmí trvat déle než `timeoutMs`. */
  aktualni(timeoutMs: number): Promise<NamerenaPoloha | null>;
  /** Poslední známá poloha ne starší než `maxStariMs`; `null` = žádná. */
  posledniZnama(maxStariMs: number): Promise<NamerenaPoloha | null>;
}

export interface PolohaVolby {
  /** Kolik času dostane čerstvé měření. Déle řidič u rampy čekat nemá. */
  timeoutMs: number;
  /** Jak stará poslední známá poloha ještě popisuje místo předání. */
  maxStariMs: number;
}

export const VYCHOZI_VOLBY: PolohaVolby = { timeoutMs: 8000, maxStariMs: 2 * 60 * 1000 };

const platna = (p: NamerenaPoloha | null): p is NamerenaPoloha =>
  p !== null &&
  Number.isFinite(p.lat) && p.lat >= -90 && p.lat <= 90 &&
  Number.isFinite(p.lon) && p.lon >= -180 && p.lon <= 180 &&
  Number.isFinite(p.timestamp);

function doPayloadu(p: NamerenaPoloha): PolohaZarizeni {
  return {
    lat: p.lat,
    lon: p.lon,
    accuracy_m: p.accuracy !== null && Number.isFinite(p.accuracy) && p.accuracy >= 0 ? p.accuracy : null,
    captured_at: new Date(p.timestamp).toISOString(),
  };
}

/**
 * Zjistí polohu pro potvrzení předání. NIKDY nevyhazuje: výsledkem je buď
 * poloha, nebo důvod, proč chybí.
 *
 * Pořadí: čerstvé měření (s limitem) → poslední známá, pokud je dost čerstvá.
 * Poslední známá je lepší než nic JEN když je mladá — stará by popisovala jiné
 * místo, než kde se předávalo, a tvářila by se jako měření.
 */
export async function zjistiPolohuPredani(
  deps: PolohaDeps,
  volby: PolohaVolby = VYCHOZI_VOLBY,
): Promise<DevicePositionPayload> {
  try {
    if ((await deps.opravneni()) !== "granted") return { unavailable: "denied" };
    if (!(await deps.sluzbyZapnute())) return { unavailable: "disabled" };

    const cerstva = await deps.aktualni(volby.timeoutMs);
    if (platna(cerstva)) return doPayloadu(cerstva);

    const posledni = await deps.posledniZnama(volby.maxStariMs);
    if (platna(posledni)) return doPayloadu(posledni);

    return { unavailable: "timeout" };
  } catch (e) {
    // Nativní vrstva vyhodila — pro předání je to táž mezera jako „nepřišlo".
    // Důvod se nese dál, takže to v záznamu vidět JE; jen nezastaví práci.
    safeWarn("poloha.predani", e);
    return { unavailable: "error" };
  }
}
