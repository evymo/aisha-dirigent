/**
 * Kdo zásilku přebírá — a proč se to nedá vzít z dat zakázky.
 *
 * ⛔ NAMĚŘENO 2026-08-20: `input_data` kroku `predani` nese `counterparty`,
 * `delivery_address`, `dl_number`, `driver_name`, `vehicle_registration`
 * a `reward` (doloženo konfigurací bloků v `41_surface_blocks.sql`, které se na
 * ně odkazují přes `input:`). ŽÁDNOU OSOBU. `counterparty` je FIRMA, ne člověk,
 * který podepsal — předvyplnit ji do pole „Přebírající (jméno)" by znamenalo
 * napsat do dokladu údaj, který nikdo neřekl.
 *
 * ⭐ CO SE MÍSTO TOHO DÁ: řidič vozí témuž odběrateli opakovaně a přebírá tam
 * zpravidla táž osoba. Nabízí se proto to, co ŘIDIČ SÁM naposledy zapsal u TÉTO
 * protistrany. Není to odvozený údaj ani domněnka o zákazníkovi — je to jeho
 * vlastní paměť, kterou by jinak nosil v hlavě.
 *
 * ⚠️ NÁVRH, NIKDY DOSAZENÍ. Do pole se nic nezapíše samo: člověk klepne na
 * jméno a tím ho potvrdí (JAZYK-05 — stroj navrhuje, člověk potvrzuje). Tichý
 * prefill by po týdnu vyrobil doklady s jménem člověka, který u toho nebyl,
 * protože pole už nikdo nečte.
 *
 * ⚠️ ZŮSTÁVÁ V ZAŘÍZENÍ. Je to pracovní pomůcka řidiče, ne evidence o osobách
 * odběratele: neodesílá se, nesynchronizuje a mizí s odhlášením (klíč nese uid,
 * viz `klic`). Jméno se do systému dostane výhradně tím, že ho člověk odešle
 * s předáním — stejně jako dosud.
 *
 * @module
 */

/** Kolik protistran si pamatujeme. Řidič má okruh, ne kartotéku. */
export const STROP = 50;

/** Jak dlouho je vzpomínka k něčemu. Po půl roce už je to spíš hádání. */
export const PLATNOST_DNI = 180;

export interface Vzpominka {
  /** Jméno, které člověk naposledy potvrdil. */
  jmeno: string;
  /** Kdy naposledy — ISO. Slouží k vypršení i k pořadí. */
  kdy: string;
}

/** Mapa: protistrana → naposledy potvrzené jméno. */
export type Pamet = Record<string, Vzpominka>;

/**
 * Klíč úložiště. Nese `uid`, takže vzpomínky jednoho řidiče se nikdy nenabídnou
 * druhému na sdíleném telefonu — táž doktrína jako u offline fronty.
 */
export function klic(uid: string): string {
  return `@aisha/prebirajici/${uid}`;
}

/**
 * Protistrana kroku — klíč, pod kterým si jméno pamatujeme.
 *
 * Defenzivně: `input_data` je konfigurace psaná lidmi. Cokoli, co není použitelný
 * text, znamená „tenhle krok si nepamatujeme" — nabídnout jméno pod prázdným
 * klíčem by ho ukázalo u všech odběratelů naráz.
 */
export function protistrana(inputData: unknown): string | null {
  const raw = (inputData as { counterparty?: unknown } | null)?.counterparty;
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t ? t : null;
}

/**
 * Co nabídnout u tohohle kroku. `null` = nic (a pole zůstane prázdné).
 *
 * Vypršelé vzpomínky se nenabízejí — po půl roce je pravděpodobnost, že tam
 * přebírá týž člověk, nižší než škoda z nabídnutí špatného jména.
 */
export function nabidka(pamet: Pamet, inputData: unknown, ted: Date): string | null {
  const kdo = protistrana(inputData);
  if (!kdo) return null;
  const v = pamet[kdo];
  if (!v?.jmeno) return null;
  const stari = (ted.getTime() - new Date(v.kdy).getTime()) / 86_400_000;
  if (!Number.isFinite(stari) || stari > PLATNOST_DNI) return null;
  return v.jmeno;
}

/**
 * Zapamatovat si potvrzené jméno. Vrací NOVOU mapu (volající ji jen přiřadí).
 *
 * Prázdné jméno se nezapisuje: řidič, který pole nechal prázdné, tím neříká
 * „přebíral nikdo" — jen ho nevyplnil, a přepsat tím minulou platnou vzpomínku
 * by byla ztráta informace.
 */
export function zapamatuj(pamet: Pamet, inputData: unknown, jmeno: string, ted: Date): Pamet {
  const kdo = protistrana(inputData);
  const cisty = jmeno.trim();
  if (!kdo || !cisty) return pamet;

  const dalsi: Pamet = { ...pamet, [kdo]: { jmeno: cisty, kdy: ted.toISOString() } };

  // Strop se drží zahozením NEJSTARŠÍCH — okruh odběratelů se v čase mění
  // a nejdéle nenavštívená protistrana je ta, kterou si nejspíš už nevybavíme.
  const klice = Object.keys(dalsi);
  if (klice.length <= STROP) return dalsi;
  klice
    .sort((a, b) => new Date(dalsi[a].kdy).getTime() - new Date(dalsi[b].kdy).getTime())
    .slice(0, klice.length - STROP)
    .forEach((k) => delete dalsi[k]);
  return dalsi;
}

/**
 * Přečíst mapu z toho, co bylo uloženo.
 *
 * ⛔ Nečitelné úložiště NENÍ prázdná paměť — ale tady je ten rozdíl neškodný
 * a mlčení je správná odpověď: nejhorší následek je, že řidič jméno napíše.
 * (U offline fronty je to naopak a `rozsifruj` proto vyhazuje výjimku.)
 */
export function zParsuj(raw: string | null | undefined): Pamet {
  if (!raw) return {};
  try {
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== "object" || Array.isArray(p)) return {};
    const out: Pamet = {};
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      const jmeno = (v as Vzpominka)?.jmeno;
      const kdy = (v as Vzpominka)?.kdy;
      if (typeof jmeno === "string" && jmeno.trim() && typeof kdy === "string") {
        out[k] = { jmeno, kdy };
      }
    }
    return out;
  } catch {
    return {};
  }
}
