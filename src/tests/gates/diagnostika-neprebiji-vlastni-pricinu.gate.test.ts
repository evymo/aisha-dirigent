/**
 * Gate: cesta, která ZAZNAMENÁVÁ selhání, nesmí selhání vyrobit ani přebít.
 *
 * ⛔ NAMĚŘENO 2026-09-07. Produkce byla 40 minut dole (jádro bez jediného
 * kontejneru) a příčinu — nekonečnou rekurzi v instančním SQL — jsme dva hledali
 * tři čtvrtě hodiny a mezitím vyslovili DVĚ špatné diagnózy. Ne proto, že by
 * příčina nebyla v logu. Proto, že ji zakryla vlastní diagnostika.
 *
 * V logu byly čtyři chyby a jen ta PRVNÍ byla příčina:
 *
 *   1. ERROR: stack depth limit exceeded          ← příčina, utopená ve 43 rámcích CONTEXTu
 *   2. ERROR: syntax error at or near "demo"      ← vyrobil si ji sám zapisovač (viz níž)
 *   3. ERROR: syntax error at or near "demo"      ← totéž podruhé
 *   4. ERROR: ... violates "migration_log_status_check"  ← nešel zapsat ani ZÁZNAM o selhání
 *
 * ⭐ ČTYŘI VADY, KTERÉ SE SKLÁDAJÍ DO KRUHU:
 *
 *  (a) `INSERT ... VALUES (..., '${TAIL}')` vkládal posledních 400 řádků výstupu
 *      migrace do SQL literálu BEZ escapování. Výstup nesl `'demo-clen-centra'`,
 *      apostrof literál ukončil a Postgres četl `demo` jako identifikátor. Zápis
 *      si tak vyrobil vlastní chybu — a ta v logu SVÍTILA jako jediná viditelná.
 *      Pikantní: o pět řádků níž stojí `ESC_TAIL` se sed-escapem. Někdo tu vadu
 *      znal a opravil ji jen v POZDĚJŠÍCH zápisech; na první zapomněl.
 *
 *  (b) `grep -E "ERROR:|FATAL:" | tail -1` bral POSLEDNÍ chybu. Poslední byla
 *      (4), tedy neúspěšná snaha zapsat záznam o chybě. Zapisovač tak ohlásil
 *      jako příčinu to, že se mu nepodařilo ohlásit příčinu. `tail -1` je tu
 *      náhrada za rozhodnutí, které nikdo neudělal: KTERÁ z chyb je příčinná?
 *      Prakticky platí, že první je příčina a zbytek jsou následky.
 *
 *  (c) kontext ±5 řádků kolem vybrané chyby. Čím VÁŽNĚJŠÍ porucha, tím delší
 *      `CONTEXT` (u nás 43 rámců rekurze) — a tím jistěji okno mine příčinu.
 *      Diagnostika, která si sama sebe přetlačí, selhává tím hůř, čím hůř je.
 *
 *  (d) CHECK na `migration_log.status` neuznával `implementation_hook_failed`,
 *      takže se nedal uložit ani ten záznam.
 *
 * ⭐ TVRZENÍ: nic, co zapisuje ZÁZNAM O SELHÁNÍ, nesmí do SQL vkládat neošetřený
 * text, a výběr „té chyby" nesmí padnout na poslední řádek. Je to táž rodina jako
 * bucket bez zakladatele nebo mrtvý resolver — jen o patro výš: tady chybí druhá
 * strana u NÁSTROJE, kterým se ostatní vady hledají. A proto bolí nejvíc.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SOUBOR = "scripts/docker-migrate-entrypoint.sh";

/** Text bez komentářů — komentář není chování. */
const bezKomentaru = (text: string) =>
  text
    .split("\n")
    .filter((r) => !/^\s*#/.test(r))
    .join("\n");

describe("zápis selhání migrace — nesmí přebít vlastní příčinu", () => {
  const existuje = existsSync(join(ROOT, SOUBOR));
  const zdroj = existuje ? bezKomentaru(readFileSync(join(ROOT, SOUBOR), "utf-8")) : "";

  test("soubor existuje (jinak brána nic neměří)", () => {
    expect(existuje, `${SOUBOR} nenalezen — detekce se rozešla se skutečností`).toBe(true);
  });

  test("do SQL se nevkládá neescapovaný TAIL ani ERROR_CONTEXT", () => {
    // Hledáme surové `'${TAIL}'` / `'${ERROR_CONTEXT}'` uvnitř SQL literálu.
    // Escapované varianty (`ESC_TAIL`, `ESC_ERROR_CONTEXT`) jsou v pořádku.
    const syrove = [...zdroj.matchAll(/'\$\{(TAIL|ERROR_CONTEXT|STATUS|CANONICAL_STATUS)\}'/g)].map(
      (m) => m[1]!,
    );
    expect(
      [...new Set(syrove)],
      "Text výstupu migrace jde do SQL literálu BEZ escapování. Výstup běžně nese\n" +
        "apostrofy (SQL z instančních dat), takže si zápis vyrobí vlastní `syntax error`\n" +
        "— a ten v logu PŘEBIJE skutečnou příčinu. Náprava: použít ESC_* variantu\n" +
        "(sed \"s/'/''/g\"), která je v souboru už připravená pro pozdější zápisy.",
    ).toEqual([]);
  });

  test("příčinná chyba se nevybírá jako POSLEDNÍ řádek", () => {
    const bereposledni = /grep[^\n]*(ERROR:|FATAL:)[^\n]*\|\s*tail\s+-1/.test(zdroj);
    expect(
      bereposledni,
      "Výběr chyby přes `| tail -1` bere POSLEDNÍ, tedy nejvzdálenější následek —\n" +
        "u nás doslova neúspěšný zápis záznamu o chybě. Příčina je zpravidla PRVNÍ.\n" +
        "Náprava: zaznamenat všechny nalezené chyby v pořadí (ať rozhoduje čtenář),\n" +
        "nebo aspoň vzít první; `tail -1` je náhrada za rozhodnutí, které nikdo neudělal.",
    ).toBe(false);
  });
});
