/**
 * Adresa VÝŘEZU obrázku pro blok: cílový rozměr, ohnisko a přiblížení jako
 * parametry veřejné cesty úložiště (`/storage/v1/object/public/…?w=&h=&fx=&fy=&z=`).
 * Výřez počítá doručení (storage-auth → podepsaný imgproxy); obrázek v úložišti
 * se nemění a každý blok si řekne o svůj tvar (karta 16:9, úzký pruh, mobil).
 *
 * Cizí adresy (články z importu odkazují na obrázky jinde) se NEUPRAVUJÍ —
 * parametry by tam nikdo nečetl a rozbily by cache klíč.
 */
export const VEREJNA_CESTA_ULOZISTE = "/storage/v1/object/public/";

export interface Vyrez {
  /** Cílová šířka a výška v px (celé číslo ≥ 1). */
  w: number;
  h: number;
  /** Ohnisko 0..1; výchozí střed. */
  fx?: number;
  fy?: number;
  /** Přiblížení 1..4; výchozí 1. */
  zoom?: number;
}

/**
 * Řádek článku z libovolného RPC: ohnisko nese jen ten, kdo ho vrací
 * (get_news_article_by_slug, get_published_news_articles_filtered); seznam bez
 * těch sloupců dostane střed a bez přiblížení — což je i DB DEFAULT.
 */
export interface OhniskoClanku {
  image_focus_x?: number | null;
  image_focus_y?: number | null;
  image_zoom?: number | null;
  [dalsi: string]: unknown;
}

/** Sloupce článku → ohnisko a přiblížení (DB má výchozí střed a 1; null = totéž). */
export function ohniskoZClanku(a: OhniskoClanku): { fx: number; fy: number; zoom: number } {
  return {
    fx: sevri(a.image_focus_x ?? 0.5, 0, 1),
    fy: sevri(a.image_focus_y ?? 0.5, 0, 1),
    zoom: sevri(a.image_zoom ?? 1, 1, 4),
  };
}

export function jeNaseUloziste(url: string): boolean {
  return url.includes(VEREJNA_CESTA_ULOZISTE);
}

/** Adresa výřezu; cizí adresa se vrátí beze změny, prázdná jako null. */
export function vyrezObrazku(url: string | null | undefined, v: Vyrez): string | null {
  if (!url) return null;
  if (!jeNaseUloziste(url)) return url;
  const [zaklad, dotaz = ""] = url.split("?", 2);
  const params = new URLSearchParams(dotaz);
  params.set("w", String(Math.max(1, Math.round(v.w))));
  params.set("h", String(Math.max(1, Math.round(v.h))));
  const fx = sevri(v.fx ?? 0.5, 0, 1);
  const fy = sevri(v.fy ?? 0.5, 0, 1);
  const zoom = sevri(v.zoom ?? 1, 1, 4);
  // Výchozí hodnoty se neposílají: kratší adresa a stejný klíč cache pro
  // články z importu, které ohnisko nemají.
  if (fx !== 0.5) params.set("fx", fx.toFixed(3)); else params.delete("fx");
  if (fy !== 0.5) params.set("fy", fy.toFixed(3)); else params.delete("fy");
  if (zoom !== 1) params.set("z", zoom.toFixed(2)); else params.delete("z");
  return `${zaklad}?${params.toString()}`;
}

function sevri(x: number, min: number, max: number): number {
  if (!Number.isFinite(x)) return min;
  return Math.min(Math.max(x, min), max);
}
