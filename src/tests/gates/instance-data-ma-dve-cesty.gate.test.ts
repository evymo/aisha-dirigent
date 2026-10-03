/**
 * Gate: „instance-data" nese DVĚ různé věci s DVĚMA různými cestami do provozu.
 * Kdo to nerozliší, nasadí a nic nedoručí — se zelenou.
 *
 * ⛔ NAMĚŘENO 2026-09-07. Kolega opravil vadu plochy a poslal SHA k rotaci.
 * Rotoval jsem `SURFACE_OVERLAY_CACHEBUST`, nasadil extranet, ohlásil hotovo —
 * a v produkční databázi zůstal vadný sloupec. Oba jsme usoudili podle JMÉNA
 * repozitáře, že cesta je jedna. Není:
 *
 *     surfaces/<instance>/{app.config.json, i18n.json, public/}
 *         → ZAPÉKÁ SE DO OBRAZU EXTRANETU
 *         → doručí rotace SURFACE_OVERLAY_CACHEBUST + nasazení EXTRANETU
 *
 *     NN_*.sql  (top-level, např. 43_audience_surface.sql, 50_demo_svet.sql)
 *         → aplikuje scripts/deploy/instance-data-hook.sh v kroku `migrate`
 *         → doručí nasazení JÁDRA
 *
 * Předchozí commit téhož repozitáře (`53aefac`, app.config.json) šel první
 * cestou a rotace ho doručila správně — což potvrdilo špatné pravidlo. Další
 * commit (`a71967b`, 43_audience_surface.sql) šel druhou a rotace ho nedoručila.
 * Táž zelená, jiný výsledek.
 *
 * ⭐ TÁŽ RODINA JAKO ZBYTEK DNEŠKA: jméno vypadá jednotně, druhá strana je
 * rozdvojená, a pozná se to až u toho, kdo sáhne. Tady navíc zákeřně: nasazení
 * proběhne ÚSPĚŠNĚ a jen nedoveze, co mělo.
 *
 * TVRZENÍ: hook musí zůstat tím, kdo aplikuje `*.sql`, a overlay plochy musí
 * zůstat tím, co se zapéká přes cachebust. Kdyby se ty dvě cesty slily nebo
 * jedna zmizela, tenhle komentář by lhal — a příští člověk by rotoval cachebust
 * na SQL změnu znovu.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const HOOK = "scripts/deploy/instance-data-hook.sh";

const bezKomentaru = (t: string) =>
  t.split("\n").filter((r) => !/^\s*#/.test(r)).join("\n");

describe("instance-data — dvě cesty do provozu, každá svým nasazením", () => {
  test("hook existuje (jinak brána nic neměří)", () => {
    expect(existsSync(join(ROOT, HOOK)), `${HOOK} nenalezen — detekce se rozešla se skutečností`).toBe(true);
  });

  test("SQL vrstvu aplikuje HOOK (tedy nasazení jádra), ne cachebust", () => {
    const src = bezKomentaru(readFileSync(join(ROOT, HOOK), "utf-8"));
    expect(
      /repo\/\*\.sql/.test(src),
      "Hook už neaplikuje top-level `*.sql` z overlay. Buď se cesta změnila, nebo\n" +
        "zmizela — v obou případech přestává platit pravidlo „SQL doručí nasazení\n" +
        "JÁDRA\", podle kterého se operátor rozhoduje. Aktualizuj hlavičku téhle brány.",
    ).toBe(true);
  });

  test("overlay plochy se zapéká přes cachebust (tedy nasazení extranetu)", () => {
    // Cachebust je build-arg extranetu: kdyby přestal existovat, rotace by přestala
    // cokoli doručovat — a mlčky, protože nasazení by dál končilo zeleně.
    const HOSTITEL = "deploy/surface-host/Dockerfile";
    const nese =
      existsSync(join(ROOT, HOSTITEL)) &&
      /SURFACE_OVERLAY_CACHEBUST/.test(readFileSync(join(ROOT, HOSTITEL), "utf-8"));
    expect(
      nese,
      "deploy/surface-host/Dockerfile nezná SURFACE_OVERLAY_CACHEBUST. Rotace by pak byla\n" +
        "obřad bez účinku: nasazení projde zeleně a overlay zůstane starý.",
    ).toBe(true);
  });
});
