/**
 * Brána: verdikt „žije to" má JEDEN domov
 *
 * INVARIANT: kdo rozhoduje o dosažitelnosti služby, rozhoduje přes
 * `scripts/lib/routing-probe.mjs` — buď přímo (Node), nebo přes
 * `scripts/lib/routing-probe-cli.mjs` (shell). Vlastní porovnání stavového
 * kódu je druhý domov téhož pravidla a jeden z nich vždycky zaostane.
 *
 * ⛔ NAMĚŘENO 2026-08-15: verdikt měl ČTYŘI domovy a ani jeden z nich neuměl
 * rozeznat odpověď, která není od služby — to uměl jedině
 * `coolify-domain-doctor.mjs`, jediný konzument sdílené sondy:
 *
 *     scripts/stack-health.sh:139   expected_codes="${3:-200}" … [[ "$http_code" == "$code" ]]
 *     scripts/smoke-routing.sh:76   [[ ",$want," == *",$code,"* ]]
 *     scripts/check-infra.mjs:133   isOk = r.status >= 200 && r.status < 400
 *     scripts/cold-start-verify.mjs:594  check.expect.includes(response.code)
 *
 * Podpis appliance za wildcard resolverem (naměřeno na Talosu):
 *
 *     curl http://neznáme-jméno/  → 302  Location: https://neznáme-jméno/
 *
 * Kontroly, které čekaly „200,302" (nocodb, appsmith, pki, mcp), by tedy
 * napsaly ✓ i pro službu, která neběží.
 *
 * TŘI VĚCI SE HLÍDAJÍ, protože každá padla jinak:
 *   1. každý konzument sdílený domov OPRAVDU konzumuje,
 *   2. kurátorovaný nárok se PŘEDÁVÁ (sjednocení nesmí ověřování oslabit),
 *   3. diskvalifikaci NELZE přebít očekávaným kódem.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { judgeResponse } from "../../../scripts/lib/routing-probe.mjs";

const ROOT = process.cwd();
const cti = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

/** Řádky bez komentářů — jinak by shodu stačilo získat POZNÁMKOU o sondě. */
const kodBezKomentaru = (p: string) =>
  cti(p)
    .split("\n")
    .filter((r) => !/^\s*(#|\/\/|\*|\/\*)/.test(r))
    .join("\n");

/**
 * Nástroj → jak se ke sdílenému domovu dostane.
 *
 * ⚠ `cold-start-doctor.sh` tu ZÁMĚRNĚ NENÍ: o dosažitelnosti služeb
 * nerozhoduje, jen o prostředí (kanárek na wildcard). Sdílenou sondu volá
 * `coolify-domain-doctor.mjs` — a ten v seznamu je. Zapsáno proto, že první
 * verze téhle brány doktora uváděla a byla zelená kvůli jeho KOMENTÁŘI
 * o sondě, ne kvůli volání (feedback_declaration_nobody_fills_is_an_ornament).
 */
const KONZUMENTI: Array<{ soubor: string; vzor: RegExp }> = [
  { soubor: "scripts/stack-health.sh", vzor: /routing-probe-cli\.mjs/ },
  { soubor: "scripts/smoke-routing.sh", vzor: /routing-probe-cli\.mjs/ },
  { soubor: "scripts/check-infra.mjs", vzor: /from ["']\.\/lib\/routing-probe\.mjs["']/ },
  { soubor: "scripts/cold-start-verify.mjs", vzor: /from ["']\.\/lib\/routing-probe\.mjs["']/ },
  { soubor: "scripts/coolify-domain-doctor.mjs", vzor: /from ["']\.\/lib\/routing-probe\.mjs["']/ },
];

describe("brána: verdikt 'žije to' má jeden domov", () => {
  it("každý nástroj, který o dosažitelnosti rozhoduje, čte sdílený domov", () => {
    // Komentáře se odstřihávají: zmínka o sondě v poznámce NENÍ konzumace.
    const chybi = KONZUMENTI.filter(({ soubor, vzor }) => !vzor.test(kodBezKomentaru(soubor))).map((k) => k.soubor);
    expect(
      chybi,
      "tyhle nástroje rozhodují o zdraví po svém — a jejich pravidlo zaostane\n" +
        "za sdíleným, jakmile se sdílené zpřísní:\n  " + chybi.join("\n  "),
    ).toEqual([]);
  });

  it("žádný z nich si nedrží VLASTNÍ porovnání stavového kódu", () => {
    // Podpisy čtyř vlastních domovů, které tahle brána zavírá. Hledá se v KÓDU,
    // ne v komentářích — ty ty řádky citují jako doklad, čím to bývalo.
    const podpisy: Array<{ soubor: string; vzor: RegExp; popis: string }> = [
      { soubor: "scripts/smoke-routing.sh", vzor: /\[\[\s*",\$want,"\s*==/, popis: 'porovnání ",$want," se stavovým kódem' },
      { soubor: "scripts/check-infra.mjs", vzor: /status\s*>=\s*200\s*&&\s*r?\.?status\s*<\s*400/, popis: '"cokoli 2xx/3xx"' },
      { soubor: "scripts/cold-start-verify.mjs", vzor: /const pass = response\.ok && check\.expect\.includes/, popis: "verdikt jen ze seznamu kódů" },
    ];
    const nalezy: string[] = [];
    for (const { soubor, vzor, popis } of podpisy) {
      if (vzor.test(kodBezKomentaru(soubor))) nalezy.push(`${soubor}: ${popis}`);
    }
    expect(nalezy, "vlastní verdikt se vrátil:\n  " + nalezy.join("\n  ")).toEqual([]);
  });

  it("sjednocení ověřování NEOSLABILO — nárok volajícího se předává", () => {
    // Kdyby se kurátorované kódy zahodily ve prospěch hrubého druhu služby,
    // `/health` s 500 by prošlo jako živé. Nárok proto musí rozhodovat.
    const host = "sluzba.priklad.cz";
    const chyba = { status: 500, headers: { "content-type": "application/json" }, bodyLen: 40 };
    expect(judgeResponse(chyba, { host, path: "/health", expect: [200] }).routed).toBe(false);
    expect(judgeResponse({ ...chyba, status: 200 }, { host, path: "/health", expect: [200] }).routed).toBe(true);
  });

  it("diskvalifikaci nelze přebít očekávaným kódem", () => {
    const host = "sluzba.priklad.cz";
    const odraz = { status: 302, headers: { location: `https://${host}/` }, bodyLen: null };
    const v = judgeResponse(odraz, { host, path: "/", expect: [200, 302] });
    expect(v.routed, "302 od appliance nesmí projít jen proto, že je v seznamu").toBe(false);
    expect(v.reason, "odmítnutí musí říct PROČ — jinak je to jen barva").toBeTruthy();
  });

  it("třetí výrok existuje: NEZMĚŘENO není nemoc", () => {
    // ⛔ NAMĚŘENO: `stack-health.sh --prod` hlásil z operátorova stroje 8/9
    // nemocných, protože se ptal na `*.mesh.<instance>.internal`. Ta jména se
    // odsud nepřeloží nikdy — ať stack žije, nebo ne.
    const cli = cti("scripts/lib/routing-probe-cli.mjs");
    expect(cli, "CLI musí umět říct NEZMĚŘENO").toMatch(/NEZMERENO/);
    expect(cli, "a musí to poznat z deklarace, ne z hádání").toMatch(/scopeProbable/);
    for (const soubor of ["scripts/stack-health.sh"]) {
      expect(
        cti(soubor),
        `${soubor} musí NEZMĚŘENO (exit 3) odlišit od nemoci — jinak vyrábí červenou bez nálezu`,
      ).toMatch(/\b3\)/);
    }
  });

  it("shrnutí nemluví o celku, když se celku nezeptalo", () => {
    // Zrcadlová vada: „All healthy" u jedné změřené z devíti je zelená proto,
    // že nevidím (feedback_gates_green_because_invisible).
    const sh = cti("scripts/stack-health.sh");
    expect(
      sh,
      "shrnutí tvrdilo All-services-healthy i tam, kde se většina neměřila",
    ).not.toMatch(/All \$\{(HEALTHY|TOTAL)\} deployed services healthy/);
    expect(sh, "pokrytí se musí říct nahlas").toMatch(/změřit nedalo|změřených služeb/);
  });
});
