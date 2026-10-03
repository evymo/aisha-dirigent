/**
 * Brána: nepřihlášený nemá v extranetu ŽÁDNÝ pobyt.
 *
 * Zadání majitele 2026-08-03: „v extranetu by nemělo být vidět přihlaste se,
 * ale pokud uživatel není autorizovaný mělo by ho to hned hodit na přihlášení,
 * vůbec mu nic z extranetu neukázat" a poté „v žádném případě se uživatel na
 * extranet nesmí dostat".
 *
 * Vlastnost, kterou hlídáme, je tvrdší než „ať to hned přesměruje": ze stavu
 * BEZ tokenu musí vést právě dvě cesty — na přihlášení, nebo na odhlášení.
 * Žádná třetí, která by uživatele nechala stát na povrchu a něco mu ukázala.
 *
 * Proč brána, a ne jen důvěra v revizi: mezistránka „Pokračovat na přihlášení"
 * tu jednou UŽ byla a vypadala neškodně — je to přirozená věc, kterou člověk
 * doplní, když chce být milý. Vrátit ji je jednořádková změna a v diffu vypadá
 * jako vylepšení. Tenhle soubor je důvod, proč to neprojde potichu.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const APP = join(ROOT, "apps/workbench-shell/src/App.tsx");
const AUTH = join(ROOT, "apps/workbench-shell/src/auth.ts");

/** Zdroj bez komentářů — komentář o `login` není přihlašovací obrazovka. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("Extranet: nepřihlášený nemá kde stát (gate)", () => {
  test("neexistuje stav pohledu, ve kterém by nepřihlášený něco viděl", () => {
    const src = code(APP);
    // `kind: 'login'` byl stav, ve kterém uživatel BEZ tokenu stál na povrchu
    // a četl uvítací kartu. Přesně to, co má být pryč.
    expect(src).not.toMatch(/kind:\s*['"]login['"]/);
  });

  test("bez tokenu se odchází na přihlášení, ne do vykreslení", () => {
    const src = code(APP);
    // Větev „nemám token" musí končit odchodem. Hledáme ji jako celek, aby
    // prošlo jen to, co po `if (!token)` skutečně volá beginLogin a vrací se.
    const bezTokenu = /if\s*\(\s*!\s*token\s*\)\s*\{[^}]*beginLogin\s*\([^}]*return[^}]*\}/s;
    expect(src).toMatch(bezTokenu);
  });

  test("neúspěšný návrat od IdP končí odhlášením, ne dalším pokusem", () => {
    const src = code(APP);
    // Když KC vydal kód a token z něj stejně není, relace u KC ŽIJE. Další
    // žádost o kód by ji mlčky použila a vzniklo by kolo bez kliknutí uživatele.
    // Odhlášení je jediný krok, který ten stav ukončí.
    const selhalo = /landing\s*===\s*['"]failed['"]\s*\)\s*\{[^}]*logout\s*\([^}]*return[^}]*\}/s;
    expect(src).toMatch(selhalo);
  });

  test("návrat od IdP rozlišuje tři stavy, ne dva", () => {
    const src = code(AUTH);
    // Kdyby `completeLoginFromRedirect` vracelo boolean, splynulo by
    // „nepřicházím z přihlášení" s „přišel jsem a nepovedlo se" — a volající
    // by nemohl sáhnout po odhlášení, protože by ty dva stavy nerozeznal.
    expect(src).toMatch(/LoginLanding\s*=\s*['"]none['"]\s*\|\s*['"]ok['"]\s*\|\s*['"]failed['"]/);
    expect(src).toMatch(/completeLoginFromRedirect\s*\(\s*\)\s*:\s*Promise<LoginLanding>/);
  });
});
