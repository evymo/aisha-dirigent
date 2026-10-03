/**
 * Překlady pro statické stránky: z ŘÁDKŮ RPC na mapu klíč → hodnota.
 *
 * ⛔ RPC VRACÍ POLE, NE MAPU (naměřeno 2026-09-03 na produkci).
 *
 * `get_translations_map_with_fallback` je SETOF funkce — PostgREST ji vydá
 * jako `[{key, value}, …]`. Generátor s ní zacházel jako s objektem
 * `Record<string,string>`, takže `preklady["web.about.title"]` bylo na poli
 * vždy `undefined`, a fallback `?? p.title_key` to zamaskoval: 10 stránek
 * odešlo na produkci s `<title>web.about.title</title>` a týmž klíčem v og:*.
 * Překlad přitom v databázi BYL (ověřeno voláním téhož RPC: "About").
 *
 * Tvar se ověřuje, ne předpokládá: cokoli, co není pole řádků `{key, value}`
 * se stringy, je chyba tvaru odpovědi — a chyba se má ohlásit, ne přejít.
 */
export function radkyNaMapu(odpoved: unknown): Record<string, string> {
  if (!Array.isArray(odpoved)) {
    throw new Error(`překlady: čekal jsem pole řádků, přišlo ${typeof odpoved}`);
  }

  const mapa: Record<string, string> = {};

  for (const [i, radek] of odpoved.entries()) {
    const key = (radek as { key?: unknown } | null)?.key;
    const value = (radek as { value?: unknown } | null)?.value;

    if (typeof key !== "string" || typeof value !== "string") {
      throw new Error(`překlady: řádek ${i} nemá tvar {key: string, value: string}`);
    }

    mapa[key] = value;
  }

  return mapa;
}

/**
 * Klíče, které stránka POTŘEBUJE a mapa je nemá. Titulek a popis stránky
 * nesmí odejít jako surový klíč — dřív to fallback dovolil (viz výše).
 */
export function chybejiciKlice(mapa: Record<string, string>, klice: (string | undefined)[]): string[] {
  return klice.filter((k): k is string => !!k && !(k in mapa));
}
