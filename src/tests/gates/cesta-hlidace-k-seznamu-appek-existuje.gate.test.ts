/**
 * Každá cesta, kterou hlídač tabletu skládá od kořene API, musí vést na
 * skutečnou routu — přes prefix, pod kterým ji gateway pouští dál.
 *
 * ⛔ PROČ TAHLE BRÁNA VZNIKLA (2026-09-22). Hlídač volal
 * `apiUrl + "/zarizeni/appky"`, jenže storage visí v gatewayi pod `/storage/v1`.
 * Server odpověděl 404, hlídač nenačetl ani SEZNAM appek a k tabletu nedorazila
 * žádná. Zavedení přitom proběhlo „úspěšně" a tablet vypadal hotově. Java hlídače
 * a TypeScript služeb nesdílí žádný typ, takže hranici nehlídal nikdo.
 *
 * ⭐ UNIVERZUM SE HLEDÁ: každé `apiUrl + "…"` a každá konstanta `CESTA_*` v Javě
 *    hlídače. Cesta pod prefixem, který brána nezná, je VADA — ne přeskočení:
 *    „nevím, kam to vede" nesmí projít jako „vede to správně".
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const KOREN = path.resolve(__dirname, "..", "..", "..");
const JAVA = path.join(KOREN, "apps/hlidac/app/src/main/java/platforma/hlidac");
const GATEWAY = path.join(KOREN, "services/gateway/src/server.ts");
const STORAGE_ROUTY = path.join(KOREN, "services/storage-auth/src/routes");

/** Prefixy gatewaye, za kterými stojí storage-auth. */
function prefixyStorage(): string[] {
  const src = readFileSync(GATEWAY, "utf8");
  return [...src.matchAll(/register\(\s*storageProxy\s*,\s*\{\s*prefix:\s*'([^']+)'/g)].map((m) => m[1]);
}

/**
 * Routy storage-auth (GET i zápisy) jako regulární výrazy (`:param` = jeden segment).
 * Kiosk Admin od 2026-09-28 i POSTuje (hlášení tabletu) — cesta, kterou má jen
 * jiná metoda, by prošla náhodou, ale 404 na zápis je táž vada jako na čtení.
 */
function routyStorage(): RegExp[] {
  const out: RegExp[] = [];
  for (const f of readdirSync(STORAGE_ROUTY)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    const src = readFileSync(path.join(STORAGE_ROUTY, f), "utf8");
    for (const m of src.matchAll(/app\.(?:get|post|put|delete)\(\s*'([^']+)'/g)) {
      const vzor = m[1].replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/:[A-Za-z_]+/g, "[^/]+");
      out.push(new RegExp(`^${vzor}$`));
    }
  }
  return out;
}

/** Cesty, které hlídač lepí ke kořeni API. */
function cestyHlidace(): { soubor: string; cesta: string }[] {
  const out: { soubor: string; cesta: string }[] = [];
  for (const f of readdirSync(JAVA).filter((x) => x.endsWith(".java"))) {
    const src = readFileSync(path.join(JAVA, f), "utf8");
    const konstanty = new Map([...src.matchAll(/static final String (CESTA_\w+)\s*=\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]));
    for (const [, c] of konstanty) out.push({ soubor: f, cesta: c });
    for (const m of src.matchAll(/apiUrl\s*\+\s*"([^"]+)"/g)) out.push({ soubor: f, cesta: m[1] });
    for (const m of src.matchAll(/apiUrl\s*\+\s*(CESTA_\w+)/g)) {
      if (!konstanty.has(m[1])) out.push({ soubor: f, cesta: `<neznámá konstanta ${m[1]}>` });
    }
  }
  return out;
}

export function vede(cesta: string, prefixy: string[], routy: RegExp[]): boolean {
  const p = prefixy.find((x) => cesta.startsWith(`${x}/`));
  if (!p) return false;
  const zbytek = cesta.slice(p.length);
  return routy.some((r) => r.test(zbytek));
}

describe("cesta hlídače k seznamu appek existuje", () => {
  const prefixy = prefixyStorage();
  const routy = routyStorage();

  it("měřidlo vidí prefix storage i routy — jinak by prošlo naprázdno", () => {
    expect(prefixy).toEqual(["/storage/v1"]);
    expect(routy.some((r) => r.test("/zarizeni/appky"))).toBe(true);
    expect(cestyHlidace().length).toBeGreaterThan(0);
  });

  it("každá cesta, kterou hlídač skládá od kořene API, vede na skutečnou routu", () => {
    const vadne = cestyHlidace().filter((c) => !vede(c.cesta, prefixy, routy));
    expect(vadne, "hlídač volá cestu, která na platformě neexistuje (404 = tablet bez appek)").toEqual([]);
  });

  it("negativní sonda: přesně ta naměřená vada (bez /storage/v1) nevede nikam", () => {
    expect(vede("/zarizeni/appky", prefixy, routy)).toBe(false);
    expect(vede("/storage/v1/zarizeni/neexistuje", prefixy, routy)).toBe(false);
    expect(vede("/storage/v1/zarizeni/appky/cz.riq.ridic.apk", prefixy, routy)).toBe(true);
  });
});
