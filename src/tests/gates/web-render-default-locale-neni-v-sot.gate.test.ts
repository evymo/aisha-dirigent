/**
 * Brána: `default_locale` v SoT NEEXISTUJE — oprava web-renderu stojí na tom
 * předpokladu, tak ho měří.
 *
 * ⛔ NAMĚŘENO 2026-09-20 na `services/svc-web-render/src/server.ts`: čtečka
 * brandingu brala jazyk z `default_locale`, který v `aisha/db/sql/` nemá ani
 * jeden výskyt → výraz byl vždy undefined a `lang` tiše spadl na „en" u každé
 * značky. Oprava (render.ts `vychozíJazyk`) proto bere jazyk z
 * `supported_languages.is_default` a bez něj nepředgeneruje nic. Chování
 * ověřuje `services/svc-web-render/src/render.test.ts`.
 *
 * Tahle brána hlídá druhou stranu: kdyby `default_locale` do SoT někdo doplnil,
 * MÁ zčervenat. Pak už čtení `default_locale` není vadou a oprava i její testy
 * měří neplatný předpoklad — je potřeba je přepsat, ne obejít.
 *
 * Převzato z návrhu session Cheers (26cfb48a3); zpřísněno o to, že chybějící
 * adresář SoT ani chyba čtení NEPROJDOU tiše (prázdný výsledek není důkaz).
 */
import { describe, expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");
const SQL_DIR = join(ROOT, "aisha/db/sql");

/**
 * Soubory v SoT, které obsahují `default_locale`. Čte se přímo, bez podprocesu
 * (grep) — brána tak zůstává v lehké dráze (`drahy-bran-manifest`) a chyba
 * čtení vyletí jako výjimka, ne jako „nic nenalezeno".
 */
function vyskytyVSot(): string[] {
  return readdirSync(SQL_DIR, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => join(d.parentPath, d.name))
    .filter((f) => readFileSync(f, "utf-8").includes("default_locale"));
}

describe("web-render: `default_locale` v SoT neexistuje", () => {
  test("SoT adresář existuje (jinak by brána měřila prázdno)", () => {
    expect(existsSync(SQL_DIR), `${SQL_DIR} chybí`).toBe(true);
  });

  test("žádný SoT soubor nezmiňuje `default_locale`", () => {
    expect(
      vyskytyVSot(),
      "`default_locale` se v SoT objevil — oprava web-renderu (jazyk z " +
        "supported_languages.is_default) pak stojí na neplatném předpokladu; " +
        "přepiš ji i s touto branou, neobcházej",
    ).toEqual([]);
  });
});
