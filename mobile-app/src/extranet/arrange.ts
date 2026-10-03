/**
 * Arrangement rules for the extranet on a phone — pure, so the screen and its
 * test share one source of truth (same reason `surfaceRouting` is pure).
 *
 * Neither rule knows any domain vocabulary: which sections exist is data the
 * backend serves, and a tape is the review_queue contract arranged differently.
 */
import type { SurfaceSection } from "./useSurface";

/**
 * Sekce, na kterou se appka ptá, když jí nikdo neřekl jinak.
 *
 * NENÍ to „ta správná sekce" — je to poslední záchrana, aby obrazovka měla na co
 * se zeptat a vykreslila svůj prázdný stav místo pádu. Co si build přeje jako
 * první, říká brand (`brand.defaultSurface`) a předává se sem parametrem
 * `preferred`; tenhle modul zůstává ČISTÝ, aby ho test mohl volat bez Expa.
 */
export const DEFAULT_SURFACE = "porada";

/**
 * Which section the screen shows.
 *
 * The user's pick always wins. Otherwise the section the BUILD prefers when it
 * is granted, else whatever the backend put FIRST — the backend owns both
 * existence and order, the client only picks a default. Inactive sections
 * (declared, not yet wired to a source) are never auto-selected: landing on a
 * section that cannot load anything would read as a broken app rather than as
 * pending work.
 *
 * ⭐ `preferred` je PARAMETR, ne konstanta uvnitř. Appka řidiče a appka
 * odečítače jsou týž kód nad jinými daty a liší se právě tímhle jediným slovem
 * — kdyby stálo zadrátované tady, byl by z jiné instance release platformy.
 *
 * Falls back to the default name when nothing is granted at all, so the screen
 * still has a surface to ask for and renders its empty state instead of crashing.
 */
export function pickSurface(
  sections: readonly SurfaceSection[],
  picked: string | null,
  preferred: string = DEFAULT_SURFACE,
): string {
  if (picked) return picked;
  const active = sections.filter((s) => s.state !== "inactive");
  if (active.some((s) => s.section === preferred)) return preferred;
  return active[0]?.section ?? preferred;
}

export interface TapeField {
  key: string;
  label_key: string;
  value?: string | number | null;
}

export interface TapeItem {
  id?: unknown;
  title?: unknown;
  quote?: unknown;
  state?: unknown;
  fields?: unknown;
}

/**
 * The day's tape: done (counted and collapsed) → NOW → ahead.
 *
 * The producer partitions by `state`; `human_confirmed` is what the RPC's
 * `include_done_today` adds to the queue. Everything else is still waiting, and
 * the FIRST waiting item is the one the user is standing on. Order is the
 * producer's — this only slices it, never sorts, because the queue's order is
 * itself information.
 */
export function partitionTape(items: readonly TapeItem[]): {
  done: TapeItem[];
  now: TapeItem | undefined;
  ahead: TapeItem[];
} {
  // ⛔ ODCHYLKA JE UZAVŘENÁ, NE PRÁCE (2026-09-29). Server posílá předání s odchylkou
  // jako `failed`; dřív se počítalo mezi čekající, takže se mohlo stát kartou „TEĎ“
  // s tlačítkem „Předání a podpis“ nad dodávkou, která je dávno vyřízená.
  const uzavrene = (i: TapeItem) => i.state === "human_confirmed" || i.state === "failed";
  const done = items.filter(uzavrene);
  const [now, ...ahead] = items.filter((i) => !uzavrene(i));
  return { done, now, ahead };
}

/**
 * Hero „TEĎ" rozebraný na části — chip, údaje a pořadí dne.
 *
 * ⭐ ČISTÁ FUNKCE, PROTOŽE JE TO PRAVIDLO, NE KRESLENÍ. Renderer si ji volá,
 * test ji volá taky — z vykresleného stromu by se dalo číst jen to, co se
 * povedlo nakreslit, kdežto tady jde změřit samo tvrzení.
 *
 * ⛔ NEVÍ, CO JE DODACÍ LIST. Chip je PRVNÍ údaj proto, že ho producent poslal
 * první — ne proto, že by to bylo číslo dokladu. Táž funkce tak obslouží
 * obchůzku měřidel, kde je první údaj něco úplně jiného, bez jediné větve.
 *
 * `position` je poctivější tvrzení než „jízda 7 z 12" z předlohy: ta stojí na
 * zakázce, kterou v datech nemáme (`Zakazka` 0 %). Tohle se POČÍTÁ z pásky —
 * kolik mám za sebou a kolik jich dnes celkem je.
 */
export function heroParts(
  item: TapeItem | undefined,
  doneCount: number,
  total: number,
): {
  chip: string | null;
  facts: TapeField[];
  position: { n: number; total: number };
  ghost: string;
} {
  const fields: TapeField[] = Array.isArray(item?.fields) ? (item.fields as TapeField[]) : [];
  const first = fields[0];
  // ⛔ TÝŽ ÚDAJ DVAKRÁT SE ČTE DVAKRÁT (2026-09-29). Producent smí citovat pole, které
  // pak vyhlásí i jako údaj (riq: `quote_src` i `fields.kam` jsou `delivery_address`);
  // karta TEĎ ho kreslila pod nadpisem jako citaci a znovu jako „Kam". Porovnává se
  // HODNOTA, ne klíč — renderer neví, že „kam" je adresa, a nemá to vědět.
  const uzZobrazene = new Set([item?.title, item?.quote].filter((v) => v != null && v !== "").map(String));
  const n = doneCount + 1;
  return {
    // Prázdná hodnota chip NEDĚLÁ — prázdný rámeček se čte jako „nezjištěno".
    chip: first?.value == null || first.value === "" ? null : String(first.value),
    facts: fields.slice(1).filter((f) => f.value == null || !uzZobrazene.has(String(f.value))),
    position: { n, total },
    ghost: dvojcifri(n),
  };
}

/**
 * Pořadí na pásce jako dvě cifry („07"). Totéž číslo nese velké „ghost" číslo
 * karty TEĎ i levý sloupec řádků — kdyby se počítalo dvakrát, rozešlo by se.
 */
export function dvojcifri(n: number): string {
  return String(Math.max(0, Math.trunc(n))).padStart(2, "0");
}
