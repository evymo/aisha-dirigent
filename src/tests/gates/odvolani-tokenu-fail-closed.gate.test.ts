/**
 * KONTROLA ODVOLÁNÍ TOKENU MUSÍ SELHÁVAT ZAVŘENĚ.
 *
 * ⛔ NAMĚŘENO NAOSTRO 2026-08-23. `shared-redis` byl nedosažitelný a gateway
 * u KAŽDÉHO přihlášeného požadavku hlásil:
 *
 *     [revocation] redis.exists failed for jti — failing open
 *
 * Následek: odvolané tokeny se přijímaly. Odhlášení, zneplatnění relace ani
 * odebrání přístupu v tu chvíli neúčinkovaly — a navenek všechno fungovalo,
 * takže si toho nikdo nevšiml. Vedlejším projevem byla 15sekundová odezva
 * (tři retry ioredis), což vypadalo jako problém výkonu, ne bezpečnosti.
 *
 * ⭐ ROZDÍL PROTI CACHE: `wp-2-1-redis-cache-layer` správně vyžaduje fail-OPEN,
 * protože cache při výpadku jen ustoupí a data se vezmou ze zdroje. Bezpečnostní
 * kontrola ustoupit NESMÍ — neznalost není důkaz platnosti. Dvě různé vlastnosti
 * nad týmž Redisem; tahle brána hlídá tu druhou.
 *
 * Majitel 2026-08-23: „nemáš info, že token není odvolán, a máš smůlu."
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const ZDROJ = join(ROOT, "packages/cache-redis/src/revocation.ts");
const text = readFileSync(ZDROJ, "utf-8");

/** Tělo funkce od její hlavičky po uzavírací závorku na sloupci 0+1. */
function telo(jmeno: string): string {
  const i = text.indexOf(`export async function ${jmeno}`);
  if (i < 0) return "";
  const j = text.indexOf("\n}", i);
  return j < 0 ? text.slice(i) : text.slice(i, j + 2);
}

describe("odvolání tokenu je fail-closed (brána)", () => {
  test("univerzum není prázdné — jinak je tvrzení níž vakuové", () => {
    expect(telo("isJwtRevoked").length, "isJwtRevoked se v modulu nenašel").toBeGreaterThan(50);
    expect(telo("areJwtsRevoked").length, "areJwtsRevoked se v modulu nenašel").toBeGreaterThan(50);
  });

  test("chyba Redisu znamená ODVOLÁN, ne 'v pořádku'", () => {
    const t = telo("isJwtRevoked");
    const catchBlok = t.slice(t.indexOf("catch"));
    expect(
      /return\s+true/.test(catchBlok),
      "větev `catch` v isJwtRevoked nevrací `true`.\n\n" +
        "Když se Redis nezeptáme, NEVÍME, jestli token platí — a neznalost se nesmí\n" +
        "vydávat za platnost. Naostro to znamenalo, že odvolané tokeny procházely,\n" +
        "zatímco navenek všechno vypadalo v pořádku.\n" +
        "Cena je vědomá: výpadek Redisu odmítne požadavky s tokenem. To je vidět\n" +
        "hned, kdežto tiché přijímání odvolaných tokenů ne.",
    ).toBe(true);
    expect(
      /return\s+false/.test(catchBlok),
      "větev `catch` pořád obsahuje `return false` — to je ta fail-open cesta",
    ).toBe(false);
  });

  test("dávková kontrola se chová stejně (jinak by stačilo ptát se hromadně)", () => {
    const t = telo("areJwtsRevoked");
    const catchBlok = t.slice(t.indexOf("catch"));
    expect(
      /set\([^)]*,\s*true\)/.test(catchBlok),
      "dávková větev `catch` v areJwtsRevoked neoznačuje tokeny za odvolané.\n" +
        "Kdyby jednotlivá kontrola byla fail-closed a dávková fail-open, dala by se\n" +
        "ta přísnost obejít pouhým hromadným dotazem.",
    ).toBe(true);
  });
});
