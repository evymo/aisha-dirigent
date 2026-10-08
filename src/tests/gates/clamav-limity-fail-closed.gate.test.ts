/**
 * Brána: clamd za limitem BLOKUJE — nepropustí neprohlédnutý obsah jako čistý
 *
 * ⛔ NÁLEZ REVIZE 2026-10-05 (bezpečnost): infra/clamav/clamd.conf neměl
 * `AlertExceedsMax`. Archiv, jehož obsah leží hlouběji než MaxRecursion (nebo za
 * MaxScanSize / MaxFileSize), clamd neprohlédne a odpoví „stream: OK" — klienti
 * (av-scan ve storage-auth a znalostní bázi, docs-scan u dokumentů) to správně
 * čtou jako čistý verdikt. Díra je v konfiguraci démona, ne v klientovi.
 *
 * A `StreamMaxLength` nebyl připnutý: výchozí 100M démona tiše ležel POD
 * MaxFileSize 128M. INSTREAM je jediná cesta, kterou platforma skenuje, takže
 * StreamMaxLength JE limit velikosti platformy — klienti vlastní konstantu nemají,
 * odpověď „size limit exceeded" čtou jako vadu souboru a blokují.
 *
 * CO SE MĚŘÍ (vlastnost konfigurace, ne vzorek):
 *   1. AlertExceedsMax je zapnutý
 *   2. StreamMaxLength je výslovně uvedený a v bajtech roven MaxFileSize
 *      (jedno číslo limitu; proud, který démon přijme, limit souboru neusekne)
 *   3. žádná direktiva není uvedená dvakrát — pozdější řádek by tiše přepsal
 *      dřívější (i tenhle zámek)
 *
 * Skutečné chování démona (zanořený archiv nad MaxRecursion) měří integrační běh
 * scripts/test/run-av-integration.mjs (src/tests/security/docs-scan-karantena.it.test.ts).
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const CONF = "infra/clamav/clamd.conf";

/** Direktivy clamd.conf: jméno → všechny uvedené hodnoty (komentáře a prázdné řádky pryč). */
function direktivy(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const radek of text.split("\n")) {
    const r = radek.trim();
    if (!r || r.startsWith("#")) continue;
    const [jmeno, ...hodnota] = r.split(/\s+/);
    out.set(jmeno, [...(out.get(jmeno) ?? []), hodnota.join(" ")]);
  }
  return out;
}

/** Velikost ve tvaru clamd.conf (číslo s volitelnou příponou K/M/G) → bajty; jinak NaN. */
function bajty(hodnota: string): number {
  const m = hodnota.match(/^(\d+)([KkMmGg]?)$/);
  if (!m) return Number.NaN;
  const nasobek = { "": 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[m[2].toLowerCase() as "" | "k" | "m" | "g"];
  return Number(m[1]) * nasobek;
}

const conf = direktivy(readFileSync(join(ROOT, CONF), "utf-8"));
const jedna = (jmeno: string): string | undefined => conf.get(jmeno)?.[0];

describe("clamd.conf: obsah za limitem neprojde jako čistý", () => {
  test("AlertExceedsMax je zapnutý — co démon neprohlédl, hlásí jako nález", () => {
    expect(jedna("AlertExceedsMax"), `${CONF}: chybí „AlertExceedsMax yes"`).toBe("yes");
  });

  test("StreamMaxLength je připnutý a roven MaxFileSize (jeden limit velikosti platformy)", () => {
    const proud = jedna("StreamMaxLength");
    const soubor = jedna("MaxFileSize");
    expect(proud, `${CONF}: StreamMaxLength není uveden — platil by výchozí limit démona`).toBeDefined();
    expect(soubor, `${CONF}: MaxFileSize není uveden`).toBeDefined();
    expect(Number.isFinite(bajty(proud!)), `StreamMaxLength „${proud}" není velikost`).toBe(true);
    expect(bajty(proud!), `StreamMaxLength ${proud} ≠ MaxFileSize ${soubor}`).toBe(bajty(soubor!));
  });

  test("žádná direktiva není uvedená dvakrát — pozdější řádek by tiše přepsal dřívější", () => {
    const dvakrat = [...conf.entries()].filter(([, h]) => h.length > 1).map(([j]) => j);
    expect(dvakrat).toEqual([]);
  });

  test("převod velikostí: přípony clamd.conf", () => {
    expect(bajty("128M")).toBe(128 * 1024 * 1024);
    expect(bajty("100m")).toBe(100 * 1024 * 1024);
    expect(bajty("64K")).toBe(64 * 1024);
    expect(bajty("1G")).toBe(1024 ** 3);
    expect(bajty("4096")).toBe(4096);
    expect(Number.isNaN(bajty("128 MB"))).toBe(true);
  });
});
