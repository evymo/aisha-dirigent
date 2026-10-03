/**
 * Kanárek na wildcard resolver — jméno, které NEMÁ resolvovat, resolvovat NESMÍ
 *
 * ── PRAVIDLO ──────────────────────────────────────────────────────────────────
 * Doctor musí na každém měřeném hostu ověřit, že NEEXISTUJÍCÍ jméno se
 * neresolvuje. Když se resolvuje, je každá sonda nad vnitřním jménem na tom
 * hostu bezcenná — dostane odpověď i pro službu, která neběží.
 *
 * ── PROČ (naměřeno živě 2026-08-13 na VŠECH čtyřech hostech) ──────────────────
 *   getent hosts <naprosto-neexistující-jméno>
 *   → adresa síťové appliance (přes search doménu s wildcardem)
 *
 * a ta appliance na LIBOVOLNÝ Host odpoví 302 s ECHEM toho Hostu. Řetěz:
 *
 *   mrtvá vnitřní služba → Docker DNS jméno nezná → propadne na hostitelský
 *   resolver → wildcard → appliance → 302 místo čistého 502
 *
 * Takhle vypadalo „auth posílá prohlížeč na <instance>-keycloak:80": keycloak
 * kontejner NEEXISTOVAL. Vypadá to jako vada konfigurace, je to mrtvá služba —
 * a diagnóza šla hodinu špatným směrem, protože symptom lhal.
 *
 * Nejzávažnější není auth, ale FALEŠNÁ ZELENÁ: healthcheck nebo sonda, která
 * curluje vnitřní jméno, dostane odpověď VŽDY. „HTTP odpovědělo" na takovém
 * hostu NENÍ důkaz života.
 *
 * ── CO SE MĚŘÍ ────────────────────────────────────────────────────────────────
 * 1. kanárek v doctoru existuje a je zapojený do TÉŽE cesty jako sonda kolizí
 *    aliasů (běží na stejné cíle, ne ve vlastní větvi, kterou nikdo nezapne),
 * 2. testované jméno je NÁHODNÉ — pevný řetězec by šel někam zapsat a kanárek
 *    by přestal měřit to, co má,
 * 3. nález je SLYŠET (warn) — a smí být „jen" varováním VÝHRADNĚ proto, že
 *    sonda mezitím umí odražeče rozpoznat sama; kdo tu schopnost odebere,
 *    musí kanárkovi vrátit blokující sílu,
 * 4. do repa se nepíše žádná adresa appliance (nález je „resolvovalo se cokoli").
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { expectedSignal } from "../../../scripts/lib/routing-probe.mjs";

const DOCTOR = path.join(process.cwd(), "scripts/cold-start-doctor.sh");
const SONDA = path.join(process.cwd(), "scripts/lib/routing-probe.mjs");
const HOST = "sluzba.priklad.cz";

/**
 * Druhy služby se ODVOZUJÍ ze zdroje, ne vypisují. Seznam v bráně by znamenal
 * druhý domov téhle konfigurace — a nový druh by kontrole unikl mlčky.
 */
const DRUHY = [
  ...new Set([
    ...[...readFileSync(SONDA, "utf8").matchAll(/^\s*case "([a-z0-9-]+)":/gm)].map((m) => m[1]),
    "http", // větev `default:` jméno v `case` nemá
  ]),
];

describe("kanárek na wildcard resolver", () => {
  const text = readFileSync(DOCTOR, "utf8");

  it("doctor kanárka má a volá ho", () => {
    expect(
      text,
      "funkce kanárka v doctoru chybí — wildcard resolver by zůstal neviditelný\n" +
        "a sondy nad vnitřními jmény by dál vracely falešnou zelenou",
    ).toMatch(/_wildcard_canary_on\s*\(\)/);
    // Deklarace bez volání je ozdoba (feedback_declaration_nobody_fills_is_an_ornament).
    const volani = [...text.matchAll(/_wildcard_canary_on\s+"/g)].length;
    expect(volani, "kanárek je definovaný, ale nikdo ho nevolá").toBeGreaterThan(0);
  });

  it("běží na TÝCHŽ cílech jako sonda kolizí aliasů", () => {
    // Vlastní seznam cílů by znamenal druhý domov téže konfigurace — a jeden
    // z nich by zůstal nenaplněný. Kanárek musí jet přes `_alias_targets`.
    const blok = text.slice(text.indexOf("_wildcard_canary_on"));
    expect(
      blok,
      "kanárek nepoužívá _alias_targets — měl by druhý domov seznamu hostů\n" +
        "a při změně by se zapnul jen jeden z obou",
    ).toMatch(/_alias_targets/);
  });

  it("testované jméno je náhodné, ne pevný řetězec", () => {
    const fn = text.slice(text.indexOf("_wildcard_canary_on"), text.indexOf("_wildcard_canary_on") + 900);
    expect(
      fn,
      "pevné jméno kanárka jde někam zapsat (hosts, DNS override) a kanárek pak\n" +
        "měří něco jiného, než si myslí — jméno musí být pokaždé jiné",
    ).toMatch(/\$RANDOM/);
  });

  it("měří UVNITŘ kontejneru, ne na hostu", () => {
    // Hostitel je INDICIE, ne důkaz: služby běží v kontejnerech a ty mají
    // vlastní cestu (Docker DNS + `search`, musl místo glibc). Naměřeno
    // 2026-08-13, že se ty dvě cesty LIŠÍ — uvnitř kontejneru `getent` jméno
    // NEresolvuje, `nslookup` ano, a Caddy resolvuje jako nslookup. Kanárek
    // měřící jen hostitele by popisoval jiný stroj, než na kterém to selhává.
    const fn = text.slice(text.indexOf("_wildcard_canary_on"));
    expect(
      fn,
      "kanárek neměří uvnitř kontejneru — hostitelský resolver není ta cesta,\n" +
        "kterou jdou služby, takže by nález nemusel nic znamenat (a naopak)",
    ).toMatch(/docker exec/);
  });

  it("chybějící nástroj = NEZMĚŘENO, ne „čisto“", () => {
    // Obrazy jsou různé; nslookup být nemusí. Kdyby chybějící nástroj spadl do
    // větve „neresolvuje", hlásil by kanárek zelenou tam, kde neměřil nic.
    const fn = text.slice(text.indexOf("_wildcard_canary_on"));
    expect(fn, "kanárek netoleruje chybějící nástroj (rc 126/127)").toMatch(/126/);
    expect(fn, "kanárek nerozlišuje NEZMĚŘENO od čistého výsledku").toMatch(/UNMEASURED/);
    const blok = text.slice(text.indexOf('case "$_canary"'), text.indexOf('case "$_canary"') + 1400);
    expect(
      blok,
      "nezměřený stav se nehlásí jako varování — prázdný výsledek z nespuštěného\n" +
        "měřidla by vypadal jako zelená (feedback_tool_failure_read_as_data)",
    ).toMatch(/warn "/);
  });

  it("nález je SLYŠET — a downgrade na varování je podmíněný schopností sondy", () => {
    const blok = text.slice(text.indexOf('_canary="'), text.indexOf('_canary="') + 1400);
    // Nález se nesmí ztratit. `warn` stačí, `info` ne — to by zapadlo v šumu.
    expect(
      blok,
      "wildcard resolver musí být slyšet: operátorovi klame ruční curl na vnitřní jméno",
    ).toMatch(/warn "/);

    // ⛔ TENHLE TEST DŘÍV VYŽADOVAL `fail`, a měl pravdu — dokud sonda brala
    // „něco odpovědělo" jako důkaz. Pak byl wildcard podmínkou, za které NELZE
    // věřit žádnému měření dosažitelnosti, a blokovat bylo jediné poctivé.
    //
    // Přestalo to platit 2026-08-15: `routing-probe.mjs` odmítá odpověď, která
    // jen vrací otázku (přesměrování zpět na týž host = podpis odražeče).
    // Víme, JAKÁ odpověď má přijít, ne jen že něco přišlo — a wildcard tím
    // falešnou zelenou vyrobit neumí.
    //
    // Ta úleva je ale PODMÍNĚNÁ. Kdo echo-kontrolu ze sondy odebere, vrátí
    // wildcard do role „nelze věřit ničemu" — a musí kanárkovi vrátit `fail`.
    const sonda = readFileSync(
      path.join(process.cwd(), "scripts/lib/routing-probe.mjs"),
      "utf8",
    );
    expect(
      sonda,
      "kanárek smí jen varovat POUZE proto, že sonda rozpozná odražeče sama;\n" +
        "bez `isEchoRedirect` je wildcard zase podmínkou nedůvěryhodnosti a patří sem `fail`",
    ).toContain("isEchoRedirect");
    // Pinuje se VLASTNOST, ne tvar volání: dřív tu stál literál
    // `!isEchoRedirect(r, host)` a upadl, jakmile funkce dostala třetí parametr.
    // Text se mění, invariant ne — každý druh služby musí odražeče odmítnout,
    // jinak platí `status > 0`, tedy důkaz o ničem. Tím se hlídá i druh, který
    // teprve přibude.
    const odraz = { status: 302, headers: { location: `https://${HOST}/` }, bodyLen: null };
    const propustne = DRUHY.filter((k) => expectedSignal(k).accept(odraz, HOST));
    expect(
      propustne,
      "tyhle druhy služby přijmou odpověď od appliance jako důkaz o službě: " + propustne.join(", "),
    ).toEqual([]);
  });
  it("do repa se nepíše adresa appliance", () => {
    // Nález je „resolvovalo se cokoli", ne „resolvovalo se na tuhle IP" — jinak
    // by v generickém stromu byla infra adresa (feedback_no_infra_in_repo) a
    // kanárek by přestal fungovat, jakmile se appliance přečísluje.
    const blok = text.slice(text.indexOf("_wildcard_canary_on"), text.indexOf("_wildcard_canary_on") + 2500);
    expect(
      blok.match(/\b\d{1,3}(\.\d{1,3}){3}\b/g) ?? [],
      "v kanárkovi je natvrdo IP adresa — nález má být 'resolvovalo se cokoli'",
    ).toEqual([]);
  });
});
