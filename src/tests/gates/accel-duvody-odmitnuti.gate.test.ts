import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { SEZNAM_DUVODU } from "../../../packages/accel-protokol/src/index.js";

/**
 * Slovník důvodů odmítnutí lane odpovídá praxi (MJ24 kontraktu jádra 0c).
 *
 * Fork se podle kódu rozhoduje, jestli funkce stojí (lane startuje, je nedostupná),
 * nebo jestli chybu udělal sám. Slovník `DUVODY_ODMITNUTI` je proto UZAVŘENÝ: kód
 * existuje jen tehdy, když ho vydává nějaká větev vynucovacího bodu nebo klienta.
 *
 *   - MRTVÉ SLOVO: kód ve slovníku, který žádný zdroj nevydává. Fork by na něj psal
 *     obsluhu, která nikdy neproběhne, a skutečný případ by šel jiným kódem.
 *   - CIZÍ LITERÁL: řetězec ve tvaru kódu (`'SLOVO_SLOVO'`) ve zdroji, který ve
 *     slovníku není. Typy `odmitnuti()` ho nepustí do odpovědi, ale v podmínce nebo
 *     v logu by tiše rozštěpil jazyk.
 *   - KLIENT vydává vlastní jen LANE_NEDOSTUPNA (návrh §1.7); ostatní kódy jen propouští.
 *   - KDO ODMÍTL: vstup se hlásí `vstup`, klient `klient` — nikdy naopak.
 *
 * ⭐ UNIVERZUM SE ČTE ZE ZDROJŮ, NEPÍŠE SE SEM. Komentáře se před hledáním odstraní:
 * kód zmíněný v dokumentaci není větev, která ho vydá.
 */
const ROOT = join(__dirname, "../../..");
const JMENA_PROSTREDI = jmenaProstrediCompose(ROOT);
const VYDAVATELE = {
  vstup: "services/svc-accel-vstup/src",
  klient: "services/svc-lane-klient/src",
} as const;
type Vydavatel = keyof typeof VYDAVATELE;
/** Vlastní kódy klienta. Cokoli dalšího klient jen propouští od vstupu. */
const KLIENT_SMI = ["LANE_NEDOSTUPNA"];
/** Pod tímhle počtem zdrojových souborů je pravděpodobnější přesunutý adresář než malá služba. */
const PODLAHA_SOUBORU: Record<Vydavatel, number> = { vstup: 6, klient: 3 };

export function bezKomentaru(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"`\\])\/\/.*$/gm, "$1");
}

/**
 * Řetězcové literály ve tvaru kódu: VELKÁ_PÍSMENA s aspoň jedním podtržítkem. Jméno proměnné
 * prostředí má týž tvar (klient lane čte `povinne('LANE_KLIENT_PORT')`), a proto se z literálů
 * vyřazují jména, která nějaký compose deklaruje v `environment:` (jediný domov těch jmen).
 */
export function literalyKodu(text: string, jmenaProstredi: ReadonlySet<string> = JMENA_PROSTREDI): Set<string> {
  return new Set(
    [...bezKomentaru(text).matchAll(/(['"`])([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\1/g)].map((m) => m[2]).filter((k) => !jmenaProstredi.has(k)),
  );
}

/** Jména proměnných prostředí ze všech compose v repu (každý nasazovač), klíče `environment:`. */
export function jmenaProstrediCompose(koren: string): Set<string> {
  const ven = new Set<string>();
  const projdi = (d: string) => {
    for (const z of readdirSync(d, { withFileTypes: true })) {
      if (z.name === "node_modules" || z.name.startsWith(".")) continue;
      const p = join(d, z.name);
      if (z.isDirectory()) projdi(p);
      else if (/compose[^/]*\.ya?ml$/i.test(z.name)) {
        let doc: { services?: Record<string, { environment?: Record<string, unknown> | string[] }> } | null = null;
        try {
          doc = parse(readFileSync(p, "utf8"));
        } catch {
          continue; // validitu YAML hlídá jiná brána
        }
        for (const sl of Object.values(doc?.services ?? {})) {
          const env = sl?.environment;
          if (Array.isArray(env)) for (const r of env) ven.add(String(r).split("=")[0]);
          else for (const k of Object.keys(env ?? {})) ven.add(k);
        }
      }
    }
  };
  projdi(koren);
  return ven;
}

/** Kdo odmítl, jak to zdroj píše do hlavičky (`HLAVICKY.ODMITL, '<kdo>'`). */
export function hlaseniOdmitl(text: string): Set<string> {
  return new Set([...bezKomentaru(text).matchAll(/HLAVICKY\.ODMITL\s*,\s*['"`]([a-z]+)['"`]/g)].map((m) => m[1]));
}

export function posud(univerzum: readonly string[], pouziti: Map<string, Set<string>>): { mrtva: string[]; cizi: string[] } {
  const vsechna = new Set([...pouziti.values()].flatMap((s) => [...s]));
  const mrtva = univerzum.filter((k) => !vsechna.has(k));
  const cizi = [...pouziti].flatMap(([kde, s]) => [...s].filter((k) => !univerzum.includes(k)).map((k) => `${kde}: ${k}`));
  return { mrtva, cizi };
}

function zdroje(adresar: string): { cesta: string; text: string }[] {
  const ven: { cesta: string; text: string }[] = [];
  const projdi = (d: string) => {
    for (const z of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, z.name);
      if (z.isDirectory()) {
        if (z.name !== "__tests__" && z.name !== "tests") projdi(p);
      } else if (z.name.endsWith(".ts") && !z.name.endsWith(".test.ts")) {
        ven.push({ cesta: relative(ROOT, p), text: readFileSync(p, "utf8") });
      }
    }
  };
  projdi(join(ROOT, adresar));
  return ven;
}

const ZDROJE = Object.fromEntries(Object.entries(VYDAVATELE).map(([k, d]) => [k, zdroje(d)])) as Record<Vydavatel, { cesta: string; text: string }[]>;
const POUZITI = new Map(Object.values(ZDROJE).flat().map((z) => [z.cesta, literalyKodu(z.text)]));

describe("slovník důvodů odmítnutí lane = praxe vstupu a klienta (MJ24)", () => {
  it("měřidlo vidí zdroje (jinak by brána mlčela naprázdno)", () => {
    expect(SEZNAM_DUVODU.length).toBeGreaterThanOrEqual(10);
    for (const v of Object.keys(VYDAVATELE) as Vydavatel[]) {
      expect(ZDROJE[v].length, `${VYDAVATELE[v]}: málo zdrojů`).toBeGreaterThanOrEqual(PODLAHA_SOUBORU[v]);
    }
  });

  it("žádné mrtvé slovo a žádný literál mimo slovník", () => {
    const { mrtva, cizi } = posud(SEZNAM_DUVODU, POUZITI);
    expect(mrtva, "kód ve slovníku, který nevydává žádná větev — vyřaď ho, nebo dopiš větev").toEqual([]);
    expect(cizi, "literál ve tvaru kódu, který slovník nezná").toEqual([]);
  });

  it("jméno proměnné prostředí z compose není kód; vymyšlený kód brána hlásí dál (mutant)", () => {
    expect(JMENA_PROSTREDI.has("LANE_KLIENT_PORT"), "měřidlo nevidí environment compose").toBe(true);
    const zdroj = "povinne('LANE_KLIENT_PORT'); odmitni('LANE_PREPLNENO');";
    expect([...literalyKodu(zdroj)]).toEqual(["LANE_PREPLNENO"]);
    expect(posud(SEZNAM_DUVODU, new Map([["mutant.ts", literalyKodu(zdroj)]])).cizi).toEqual(["mutant.ts: LANE_PREPLNENO"]);
  });

  it("klient vydává vlastní jen LANE_NEDOSTUPNA", () => {
    const klienta = [...new Set(ZDROJE.klient.flatMap((z) => [...literalyKodu(z.text)]))].sort();
    expect(klienta).toEqual(KLIENT_SMI);
  });

  it("kdo odmítl: vstup hlásí jen `vstup`, klient jen `klient`", () => {
    for (const v of Object.keys(VYDAVATELE) as Vydavatel[]) {
      const kdo = new Set(ZDROJE[v].flatMap((z) => [...hlaseniOdmitl(z.text)]));
      expect([...kdo], VYDAVATELE[v]).toEqual([v]);
    }
  });

  describe("samotest měřidla", () => {
    it("pozná mrtvé slovo i cizí literál; komentář se nepočítá jako větev", () => {
      const pouziti = new Map([["a.ts", literalyKodu("// 'C_D' jen v komentáři\nreturn odmitni(r, 'A_B', 'x'); if (k === \"E_F\") {}")]]);
      expect(posud(["A_B", "C_D"], pouziti)).toEqual({ mrtva: ["C_D"], cizi: ["a.ts: E_F"] });
    });
    it("URL v řetězci není komentář; blokový komentář ano", () => {
      expect([...literalyKodu("const u = 'http://x'; /* 'B_C' */ f('A_B');")]).toEqual(["A_B"]);
    });
    it("najde, kdo odmítl, i když kód hlavičku skládá přes konstantu", () => {
      expect([...hlaseniOdmitl("reply.header(HLAVICKY.ODMITL, 'klient')")]).toEqual(["klient"]);
    });
  });
});
