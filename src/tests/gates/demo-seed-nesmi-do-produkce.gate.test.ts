/**
 * Demo seed NESMÍ do produkce ani při selhání (CLASS gate)
 *
 * ⛔ NAMĚŘENO 2026-09-04. `docker-migrate-entrypoint.sh` měl v jednom bloku dvě
 * věci, které si přímo odporovaly:
 *
 *     if [ -z "$SEED_IMPLEMENTATION" ]; then
 *       log "FATAL: … Dosazení výchozí hodnoty by naseedovalo data jiné instance."
 *       exit 2                                  ← odmítá HÁDAT, čí data sype
 *     fi
 *     node scripts/db/compile-seed.mjs … \
 *       || log "WARN … falling back to committed seed.compiled.sql"
 *                                               ← a při selhání hádá SÁM
 *
 * A komentář o pár řádků výš přitom slibuje: „Demo is never silently included
 * in prod."
 *
 * Zakommitovaný `seed.compiled.sql` nese v hlavičce:
 *     Profile: demo · Implementation: (none)
 *     Source: seed/core/, seed/translations/, seed/demo/
 *
 * Fallback tedy při selhání kompilace sypal do PRODUKČNÍ databáze demo data —
 * tiše, jen s `WARN`.
 *
 * ⭐ TŘÍDA VADY: FALLBACK, KTERÝ POPÍRÁ VLASTNÍ INVARIANT. Stráž nad ním byla
 * napsaná správně a se správným odůvodněním; o tři řádky níž ji tentýž blok
 * obcházel. Nejistota o tom, ČÍ data se sypou, musí být STOP — neseedovaná
 * databáze je vratný stav, cizí obsah v produkci ne.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const cti = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "");

/** Kód bez komentářů — brána nesmí trestat text, který pravidlo vysvětluje. */
const bezKomentaru = (sh: string) => sh.split("\n").filter((r) => !/^\s*#/.test(r)).join("\n");

const entrypoint = cti("scripts/docker-migrate-entrypoint.sh");

describe("demo seed nesmí do produkce", () => {
  test("entrypoint existuje — jinak brána měří prázdno", () => {
    expect(entrypoint.length, "docker-migrate-entrypoint.sh nenalezen").toBeGreaterThan(0);
  });

  test("⛔ selhání compile-seed NESMÍ pokračovat na zakommitovaný seed", () => {
    const kod = bezKomentaru(entrypoint);
    expect(
      kod,
      "`compile-seed.mjs` volané s `|| log …` znamená, že se při selhání pokračuje " +
        "a `db:seed` aplikuje ZAKOMMITOVANÝ seed.compiled.sql — což je profil 'demo' " +
        "bez implementace. Nejistota o tom, čí data se sypou, je STOP.",
    ).not.toMatch(/compile-seed\.mjs[\s\S]{0,200}?\|\|\s*log/);
  });

  test("selhání kompilace končí nenulově", () => {
    const kod = bezKomentaru(entrypoint);
    const blok = kod.slice(kod.indexOf("compile-seed.mjs"));
    expect(
      blok.slice(0, 500),
      "po neúspěšné kompilaci musí následovat ukončení, ne pokračování na db:seed",
    ).toMatch(/exit\s+[1-9]/);
  });

  test("zakommitovaný seed je opravdu 'demo' — kdyby nebyl, brána měří jiný svět", () => {
    const seed = cti("aisha/db/seed.compiled.sql").slice(0, 2000);
    if (!seed) return; // soubor smí zmizet; pak není co chránit
    expect(
      seed,
      "kdyby zakommitovaný seed přestal být demo profilem, odůvodnění téhle brány " +
        "by přestalo platit a je potřeba ho přepsat, ne bránu smazat",
    ).toMatch(/Profile:\s*demo/i);
  });
});
