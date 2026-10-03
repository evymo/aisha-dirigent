/**
 * Domov pro dvě otázky, které si brány dosud zodpovídaly každá po svém:
 *
 *   1. „jak se uvnitř jmenuje služba X?"
 *   2. „je služba X na síti Y?"
 *
 * ⛔ NAMĚŘENO 2026-08-16: deset bran mělo adresu opsanou v regulárním výrazu —
 * `minio:9000`, `n8n:5678`, `netbird-management:443`, a jedna dokonce
 * `http://aisha-kronos-shim:9625` s identitou PLATFORMY. Když se adresy začaly
 * odvozovat z identity instance, všech deset spadlo naráz. Ne proto, že by se
 * něco rozbilo — proto, že každá měřila vlastní kopii odpovědi.
 *
 * Adopce AISHA stacku je pokaždé jedinečná: jiný prefix, jiné domény, jiný
 * hostitel. Očekávání v bráně proto NESMÍ být literál. Musí se skládat z téhož
 * mechanismu, jakým se skládá skutečná adresa — jinak brána zamkne stav jedné
 * instalace a každou další ohlásí jako vadu.
 *
 * Na sítě se ptáme PARSERU, ne textu. `networks: [coolify, internal]` a
 * `networks: {coolify: null, internal: {...}}` znamenají totéž; `- coolify`
 * v textu hledá jen jeden z těch dvou zápisů a druhý prohlásí za chybějící.
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { parse } from "yaml";

/**
 * Jak se identita píše ve zdroji compose. `:?` je záměr: prázdná identita má
 * shodit deploy, ne se tiše dosadit — fork bez deklarace by jinak zabral jména
 * platformy (kořen squattingu, #163).
 */
export const IDENTITA = "${APP_NAME_PREFIX:?identita instance}";

/** Vnitřní jméno služby tak, jak stojí ve zdroji compose. */
export function vnitrniHost(sluzba: string, port?: number | string): string {
  return port === undefined ? `${IDENTITA}-${sluzba}` : `${IDENTITA}-${sluzba}:${port}`;
}

/** Týž tvar jako `vnitrniHost`, ale zaescapovaný pro vložení do RegExp. */
export function reHost(sluzba: string, port?: number | string): string {
  return vnitrniHost(sluzba, port).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sítě služby — z PARSERU, tedy nezávisle na tom, jestli je zápis seznam nebo
 * slovník. Kotvy (`<<: *anchor`) YAML parser rozbalí sám, takže se započítají
 * i sítě zděděné.
 */
export function sitiSluzby(composeText: string, sluzba: string): string[] {
  const doc = parse(composeText) as { services?: Record<string, { networks?: unknown }> };
  const spec = doc?.services?.[sluzba];
  if (!spec) return [];
  const n = spec.networks;
  if (Array.isArray(n)) return n.map(String);
  if (n && typeof n === "object") return Object.keys(n as Record<string, unknown>);
  return [];
}

/** Je služba připojená na tu síť? Ptá se parseru, ne textu. */
export function naSiti(composeText: string, sluzba: string, sit: string): boolean {
  return sitiSluzby(composeText, sluzba).includes(sit);
}

/** Aliasy služby na dané síti — deklarované, ne odvozené z `container_name`. */
export function aliasyNaSiti(composeText: string, sluzba: string, sit: string): string[] {
  const doc = parse(composeText) as {
    services?: Record<string, { networks?: Record<string, { aliases?: string[] } | null> }>;
  };
  const n = doc?.services?.[sluzba]?.networks;
  if (!n || Array.isArray(n)) return [];
  return n[sit]?.aliases ?? [];
}

/** Načte compose ze zdroje repa. */
export function compose(nazev: string, root = process.cwd()): string {
  return readFileSync(path.join(root, nazev), "utf8");
}

// ── Blok služby: text, ne strom ──────────────────────────────────────────────
//
// ⛔ ŠEST KOPIÍ TÉHOŽ, KAŽDÁ JINAK (naměřeno 2026-09-03, audit U7-4).
//
// Brány, které se ptají na TEXT služby (má healthcheck? jaké nese env? je tam
// `restart: "no"`?), si dodneška každá nesla vlastní extraktor:
//
//   coolify-compose-compliance   řádkový sken s hloubkou
//   coolify-domain-format        řádkový sken
//   infrastructure-security      řádkový sken
//   oauth2-proxy-config          řádkový sken
//   jvm-service-mem-limit        vlastní `serviceBlocks()` nad všemi službami
//   wp-4-3-bge-reranker          `indexOf("<jméno>:")` + regex na oddělovače
//
// Ta poslední je nejkřehčí: `indexOf` najde jméno kdekoli — v komentáři,
// v hodnotě proměnné, v cizí službě, jejíž jméno tu naši obsahuje jako
// podřetězec. A všechny sdílejí druhou vadu: komentář NAD službou B se čte
// jako součást bloku A, protože blok končí až na dalším klíči. Próza tak
// mění verdikt brány — táž třída, kterou dnes musely opravit tři brány.
//
// Tahle funkce se ptá PARSERU, kde služba začíná (existuje? jak se doopravdy
// jmenuje?), a text pak řeže podle odsazení, protože brány potřebují vidět
// původní zápis — `${VAR}`, uvozovky, víceřádkové příkazy. Komentáře, které
// patří NÁSLEDUJÍCÍ službě, se do bloku nepočítají.
export function sluzebniBlok(composeText: string, sluzba: string): string | null {
  const doc = parse(composeText) as { services?: Record<string, unknown> };
  if (!doc?.services || !(sluzba in doc.services)) return null;

  const radky = composeText.split("\n");
  const zacatek = radky.findIndex((r) => new RegExp(`^\\s{2}${sluzba}:\\s*(#.*)?$`).test(r));
  if (zacatek < 0) return null;

  const odsazeni = (radky[zacatek].match(/^\s*/) ?? [""])[0].length;
  let konec = zacatek + 1;
  let posledniObsah = zacatek;

  while (konec < radky.length) {
    const r = radky[konec];
    if (r.trim() === "") { konec += 1; continue; }
    const jeho = (r.match(/^\s*/) ?? [""])[0].length;
    if (jeho <= odsazeni) break;
    // Komentář si drží místo jen tehdy, když po něm ještě přijde obsah TÉHLE
    // služby; jinak patří tomu, co následuje.
    if (!r.trim().startsWith("#")) posledniObsah = konec;
    konec += 1;
  }

  return radky.slice(zacatek, posledniObsah + 1).join("\n");
}
