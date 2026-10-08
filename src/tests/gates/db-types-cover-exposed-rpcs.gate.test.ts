/**
 * Gate: the generated DB types describe every RPC the API actually exposes.
 *
 * WHY THIS EXISTS (2026-07-28)
 * ---------------------------
 * `db-types-mobile-web-sync` compares the two generated type files TO EACH
 * OTHER. That catches one file being regenerated without the other, and nothing
 * else: when both go stale together it stays green. They did — 702 lines of
 * drift, including `list_surface_sections`, which existed in the SQL source of
 * truth and in neither types file. A client written against those types cannot
 * see an RPC that the database has been serving for a day.
 *
 * WHY NOT REGENERATE AND DIFF
 * ---------------------------
 * The obvious check — regenerate the types in CI and fail on a diff — was tried
 * first and abandoned on purpose. `scripts/db/gen-types.mjs` shells out to a
 * third-party CLI (see that file), pulled UNPINNED from npm, which starts a
 * schema-introspection CONTAINER that opens its own connection to the database.
 * In CI that container sits in its own network namespace and cannot reach a
 * Postgres joined to the job's namespace, so it fails with introspection errors
 * that read like a database fault and are a topology fault. Putting that on the
 * critical path of every pull request would mean an unpinned third-party
 * dependency, an external image registry and a container runtime — for a check
 * about the contents of two files in this repo. (This repo also ratchets down
 * references to that vendor; spreading them into a new gate works against it.)
 *
 * So the check reads the source of truth instead: `db:rpc:inventory` already
 * parses aisha/db/sql/functions/ without a database, a container or a network.
 *
 * WHAT IS EXCLUDED IS DERIVED, NOT LISTED
 * ---------------------------------------
 * A function is absent from the generated types for exactly three legitimate
 * reasons, all readable from its own definition:
 *   - it RETURNS trigger / event_trigger — PostgREST cannot call it
 *   - nothing GRANTs EXECUTE to a PostgREST role — it is unreachable
 *   - it is created outside schema `public` — the types describe `public` only
 * All are read per-file. No name appears in this gate.
 *
 * THE METER IS MEASURED TOO (2026-10-04)
 * --------------------------------------
 * ⛔ NAMĚŘENO: parser grantů hledal `ON FUNCTION \S+ TO` a signaturu s mezerou
 * (`f(uuid, uuid)`) neviděl. U 1005 z 1726 vydaných funkcí tak vyšlo „nikdo ji
 * nesmí volat“ a brána je přeskočila — zelená pro 58 % plochy, kterou má hlídat.
 * Dvě RPC (v SoT od 2026-10-01) v typech chyběly a nic nespadlo. Kotva
 * „inventář není prázdný“ to nechytla: 721 je víc než 100.
 * Proto níž druhý, nezávislý měřák grantů (příkaz po příkazu, bez vzoru nad
 * signaturou): oba se musí shodnout nad každým souborem SoT.
 */
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRpcInventory } from "../../../scripts/db/lib/rpc-inventory.mjs";
import { extractGrants } from "../../../scripts/db/func-manager/lib/parser.mjs";

const ROOT = process.cwd();
const FUNCTIONS_DIR = join(ROOT, "aisha/db/sql/functions");
const WEB_TYPES = join(ROOT, "src/integrations/db/types.ts");
const MOBILE_TYPES = join(ROOT, "mobile-app/src/types/database.ts");

/**
 * Functions the generator drops even though they are granted and callable,
 * because it cannot map their parameter types (`vector` from pgvector,
 * `text[][]`). A ratchet, not an allowlist: the COUNT is pinned, so a newly
 * missing RPC fails here even though this one remains. Fixing it means
 * teaching the generator about those types — a separate change, and one that
 * needs the generator replaced first (see the note above).
 *
 * ⛔ NAMĚŘENO 2026-09-20: po `db:types:refresh:throwaway` chybí UŽ JEN
 * `audience_user_meets_tier_requirement`. Druhý kus dluhu nebyl nemapovatelný
 * typ, ale prostě NEPŘEGENEROVANÉ typy (`resolve_brand_for_hostname`) — ráčna
 * proto klesá 2 → 1, aby se ten rozdíl nemohl tiše vrátit.
 *
 * ⛔ NAMĚŘENO 2026-10-04: ráčna klesá 1 → 0. Ani `audience_user_meets_tier_requirement`
 * nebyla nemapovatelná — v typech JE. Generátor funkci s přetížením tiskne jako
 * sjednocení (`jmeno:` a `| {` až na dalším řádku) a čtečka jmen níž čekala `{`
 * hned za dvojtečkou, takže každou přetíženou funkci hlásila jako chybějící.
 */
const KNOWN_UNGENERATABLE = 0;

/**
 * Příjemci, přes které funkci zavolá role PostgRESTu. `public` (PUBLIC) k nim patří:
 * je to každá role, tedy i anon. ⛔ NAMĚŘENO 2026-10-04: 9 funkcí SoT je vydaných
 * jen `TO public` a brána je dřív za vydané nepovažovala.
 */
const GRANTEES = ["anon", "authenticated", "service_role", "public"] as const;
type Grantee = (typeof GRANTEES)[number];

/**
 * Function names in the `Functions:` block of a generated types file. An
 * overloaded function is printed as a union — the key is followed by a newline
 * and `| {`, not by `{` — so the key alone is what identifies an entry.
 */
function generatedFunctionNames(path: string): Set<string> {
  const body = readFileSync(path, "utf8");
  const block = body.match(/Functions:\s*\{(.*?)\n {4}\}/s);
  if (!block) throw new Error(`${path}: no Functions block — the generator's shape changed`);
  return new Set([...block[1].matchAll(/^ {6}([a-z0-9_]+):/gm)].map((m) => m[1]));
}

/** Schemas the file creates functions in; an unqualified name lands in `public`. */
function schemasOfCreatedFunctions(sql: string): string[] {
  return [...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?([a-z_][a-z0-9_]*)"?\s*\.)?/gi)].map((m) =>
    (m[1] ?? "public").toLowerCase(),
  );
}

/** Every SoT function PostgREST can serve, with the reason derived per file. */
function exposedRpcs(): string[] {
  return buildRpcInventory(ROOT)
    .filter((entry: { name: string; file: string }) => {
      const sql = readFileSync(join(FUNCTIONS_DIR, entry.file), "utf8");
      if (/returns\s+(event_)?trigger\b/i.test(sql)) return false;
      const schemas = schemasOfCreatedFunctions(sql);
      if (schemas.length > 0 && !schemas.includes("public")) return false;
      const g = extractGrants(sql);
      return GRANTEES.some((grantee) => g[grantee]);
    })
    .map((entry: { name: string }) => entry.name);
}

/**
 * Druhý měřák grantů, záměrně jinak postavený než `extractGrants`: čte příkaz po
 * příkazu a příjemce bere jako konec příkazu za posledním TO / FROM — žádný vzor
 * nad signaturou funkce, takže ho mezera v signatuře oslepit nemůže.
 * Vedle toho hlásí REVOKE příjemce, které přichází PO jeho GRANTu: `extractGrants`
 * pořadí příkazů nemodeluje a spoléhá na to, že takový soubor v SoT není.
 */
function grantsByStatement(sql: string): { granted: Record<Grantee, boolean>; revokedAfterGrant: Grantee[] } {
  const withoutComments = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
  const granted: Record<Grantee, boolean> = { anon: false, authenticated: false, service_role: false, public: false };
  const revokedAfterGrant: Grantee[] = [];
  for (const statement of withoutComments.split(";").map((part) => part.trim())) {
    const verb = statement.split(/\s+/)[0]?.toUpperCase();
    if ((verb !== "GRANT" && verb !== "REVOKE") || !/\sFUNCTION\s/i.test(statement)) continue;
    const tail = statement.split(verb === "GRANT" ? /\sTO\s/i : /\sFROM\s/i).pop() ?? "";
    const named = tail.toLowerCase().split(/[\s,]+/).map((role) => role.replace(/"/g, ""));
    for (const grantee of GRANTEES) {
      if (!named.includes(grantee)) continue;
      if (verb === "GRANT") granted[grantee] = true;
      else if (granted[grantee]) revokedAfterGrant.push(grantee);
    }
  }
  return { granted, revokedAfterGrant };
}

function sotFunctionFiles(): string[] {
  return readdirSync(FUNCTIONS_DIR).filter((file) => file.endsWith(".sql")).sort();
}

describe("generated DB types cover every exposed RPC", () => {
  test("no exposed RPC is missing from the web types", () => {
    const generated = generatedFunctionNames(WEB_TYPES);
    const missing = exposedRpcs().filter((n) => !generated.has(n)).sort();

    expect(
      missing.length,
      missing.length > KNOWN_UNGENERATABLE
        ? `RPCs in the SQL source of truth and NOT in src/integrations/db/types.ts:\n` +
          missing.map((n) => `  ${n}`).join("\n") +
          `\n\nRegenerate with: npm run db:types:refresh:throwaway`
        : "",
    ).toBeLessThanOrEqual(KNOWN_UNGENERATABLE);
  });

  test("both generated files describe the same functions", () => {
    const web = generatedFunctionNames(WEB_TYPES);
    const mobile = generatedFunctionNames(MOBILE_TYPES);
    const onlyWeb = [...web].filter((n) => !mobile.has(n)).sort();
    const onlyMobile = [...mobile].filter((n) => !web.has(n)).sort();

    expect(
      { onlyWeb, onlyMobile },
      "one surface was regenerated without the other",
    ).toEqual({ onlyWeb: [], onlyMobile: [] });
  });

  test("the inventory itself is non-empty — an empty check passes for the wrong reason", () => {
    expect(exposedRpcs().length).toBeGreaterThan(100);
  });
});

describe("měřák grantů vidí to, co v SoT je", () => {
  test("oba měřáky se shodnou nad každým souborem SoT", () => {
    const rozdily = sotFunctionFiles().flatMap((file) => {
      const sql = readFileSync(join(FUNCTIONS_DIR, file), "utf8");
      const parser = extractGrants(sql);
      const { granted } = grantsByStatement(sql);
      const ruzne = GRANTEES.filter((g) => parser[g] !== granted[g]);
      return ruzne.length > 0 ? [`${file}: ${ruzne.map((g) => `${g} parser=${parser[g]} příkazy=${granted[g]}`).join(", ")}`] : [];
    });

    expect(
      rozdily,
      "extractGrants a čtení příkaz po příkazu se rozcházejí — jeden z měřáků grant nevidí, " +
        "a funkce, u které brána grant nevidí, se v typech nehlídá vůbec. Oprav měřák, ne tento seznam.",
    ).toEqual([]);
  });

  test("kotva: shoda není shodou dvou slepých — signaturu s mezerou vidí oba", () => {
    const sMezerou = sotFunctionFiles().filter((file) =>
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+[\w."]+\([^)]*\s[^)]*\)\s+TO\s/i.test(readFileSync(join(FUNCTIONS_DIR, file), "utf8")),
    );
    expect(sMezerou.length, "SoT nemá grant se signaturou s mezerou — kotva nemá co měřit").toBeGreaterThan(0);

    const nevidi = sMezerou.filter((file) => {
      const sql = readFileSync(join(FUNCTIONS_DIR, file), "utf8");
      const parser = extractGrants(sql);
      const { granted } = grantsByStatement(sql);
      return !GRANTEES.some((g) => parser[g]) || !GRANTEES.some((g) => granted[g]);
    });
    expect(nevidi, "grant se signaturou s mezerou některý měřák nevidí").toEqual([]);
  });

  test("žádný soubor SoT neodvolává příjemce poté, co mu funkci vydal", () => {
    const odvolane = sotFunctionFiles().flatMap((file) => {
      const { revokedAfterGrant } = grantsByStatement(readFileSync(join(FUNCTIONS_DIR, file), "utf8"));
      return revokedAfterGrant.length > 0 ? [`${file}: ${revokedAfterGrant.join(", ")}`] : [];
    });

    expect(
      odvolane,
      "extractGrants pořadí GRANT → REVOKE nemodeluje (každý GRANT bere jako platný). " +
        "Jakmile takový soubor vznikne, nauč parser pořadí příkazů — do té doby by funkci hlásil jako vydanou.",
    ).toEqual([]);
  });
});

/**
 * ARGUMENTY, NE JEN JMÉNA.
 *
 * ⛔ NAMĚŘENO 2026-09-13: `upsert_discovered_model` dostal v SoT parametr
 * `p_embedding_dimensions` (discovery ho posílá), ale v obou generovaných souborech
 * chyběl — test výš prošel, protože měří jen to, že funkce v typech JE. Změřeno přes
 * celé SoT: 1610 funkcí (včetně přetížení v jednom souboru), 0 nečitelných signatur,
 * rozdíl argumentů právě u téhle jedné. Klient psaný proti typům by nový parametr
 * nesměl poslat.
 *
 * Signatura se čte ze SQL bez databáze (tentýž důvod jako výš): komentáře pryč,
 * seznam parametrů mezi závorkami, dělení čárkou nejvyšší úrovně s ohledem na
 * závorky, hranaté závorky (`ARRAY[...]` v DEFAULT) a řetězce; OUT parametry do
 * `Args` nepatří. Funkce s víc definicemi v souboru = množina signatur proti množině
 * `Args` přetížení v typech.
 */
export function signaturySql(sql: string): Array<{ jmeno: string; argumenty: string[] }> | null {
  const bez = sql.replace(/--[^\n]*/g, "");
  const out: Array<{ jmeno: string; argumenty: string[] }> = [];
  for (const m of bez.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\(/gi)) {
    let i = (m.index ?? 0) + m[0].length;
    let hloubka = 1;
    let retezec = false;
    const od = i;
    for (; i < bez.length && hloubka > 0; i++) {
      const c = bez[i];
      if (c === "'") retezec = !retezec;
      if (retezec) continue;
      if (c === "(") hloubka++;
      else if (c === ")") hloubka--;
    }
    const surove = bez.slice(od, i - 1);
    const casti: string[] = [];
    let aktualni = "";
    let h = 0;
    let r = false;
    for (const c of surove) {
      if (c === "'") r = !r;
      if (!r) {
        if (c === "(" || c === "[") h++;
        if (c === ")" || c === "]") h--;
        if (c === "," && h === 0) {
          casti.push(aktualni);
          aktualni = "";
          continue;
        }
      }
      aktualni += c;
    }
    if (aktualni.trim()) casti.push(aktualni);
    const argumenty: string[] = [];
    for (const cast of casti) {
      const p = cast.trim().match(/^(?:(IN|OUT|INOUT|VARIADIC)\s+)?([a-z_][a-z0-9_]*)\s+/i);
      if (!p) return null; // nečitelná signatura — hlásí se, nemlčí
      if (p[1]?.toUpperCase() === "OUT") continue;
      argumenty.push(p[2]);
    }
    out.push({ jmeno: m[1], argumenty: argumenty.sort() });
  }
  return out;
}

/** `Args` každého přetížení funkce v bloku `Functions` generovaných typů (seřazené klíče). */
export function argumentyVTypech(body: string): Map<string, string[][]> {
  const blok = body.match(/Functions:\s*\{(.*?)\n {4}\}/s)?.[1];
  if (!blok) throw new Error("typy nemají blok Functions — generátor změnil tvar");
  const zacatky = [...blok.matchAll(/^ {6}([a-z0-9_]+):\s*/gm)].map((m) => ({ jmeno: m[1], od: m.index ?? 0 }));
  const telo = (text: string): string => {
    let h = 0;
    let st = -1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "{") {
        if (h === 0) st = i + 1;
        h++;
      } else if (text[i] === "}") {
        h--;
        if (h === 0) return text.slice(st, i);
      }
    }
    return "";
  };
  const klice = (text: string): string[] => {
    const out: string[] = [];
    let h = 0;
    for (const m of text.matchAll(/([{}])|(?:^|[\s;])([a-z_][a-z0-9_]*)\??:/g)) {
      if (m[1] === "{") h++;
      else if (m[1] === "}") h--;
      else if (h === 0) out.push(m[2]);
    }
    return out.sort();
  };
  const mapa = new Map<string, string[][]>();
  zacatky.forEach((z, k) => {
    const kus = blok.slice(z.od, k + 1 < zacatky.length ? zacatky[k + 1].od : blok.length);
    const pretizeni = [...kus.matchAll(/Args:\s*/g)].map((a) => {
      const za = kus.slice((a.index ?? 0) + a[0].length);
      return za.startsWith("never") ? [] : klice(telo(za));
    });
    mapa.set(z.jmeno, pretizeni);
  });
  return mapa;
}

/** Rozdíly SoT × typy pro jeden generovaný soubor; `nezmereno` = soubory, jejichž signaturu nešlo přečíst. */
export function rozdilyArgumentu(
  sot: Array<{ soubor: string; sql: string }>,
  typy: string,
): { porovnano: number; nezmereno: string[]; rozdily: string[] } {
  const vTypech = argumentyVTypech(typy);
  const klic = (sady: string[][]) => [...new Set(sady.map((a) => a.join(",")))].sort().join(" | ");
  let porovnano = 0;
  const nezmereno: string[] = [];
  const rozdily: string[] = [];
  for (const { soubor, sql } of sot) {
    const sig = signaturySql(sql);
    if (sig === null) {
      nezmereno.push(soubor);
      continue;
    }
    const podleJmena = new Map<string, string[][]>();
    for (const s of sig) podleJmena.set(s.jmeno, [...(podleJmena.get(s.jmeno) ?? []), s.argumenty]);
    for (const [jmeno, sady] of podleJmena) {
      const gen = vTypech.get(jmeno);
      if (!gen) continue; // chybějící funkci hlásí test „no exposed RPC is missing"
      porovnano++;
      if (klic(sady) !== klic(gen)) rozdily.push(`${soubor}: SoT (${klic(sady)}) ≠ typy (${klic(gen)})`);
    }
  }
  return { porovnano, nezmereno, rozdily };
}

describe("generated DB types carry the SoT arguments of every RPC", () => {
  const sot = readdirSync(FUNCTIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((soubor) => ({ soubor, sql: readFileSync(join(FUNCTIONS_DIR, soubor), "utf8") }));

  for (const [nazev, cesta] of [["web", WEB_TYPES], ["mobile", MOBILE_TYPES]] as const) {
    test(`⛔ ${nazev}: Args každé funkce = parametry její SoT signatury`, () => {
      const r = rozdilyArgumentu(sot, readFileSync(cesta, "utf8"));
      expect(r.porovnano, "měřidlo nic neporovnalo — parser signatur nebo typů je slepý").toBeGreaterThan(1000);
      expect(r.nezmereno, "SoT signatura, kterou parser neumí přečíst, je NEZMĚŘENO — oprav parser, ne výjimku").toEqual([]);
      expect(
        r.rozdily,
        "Generované typy nesedí na SoT signaturu. Regeneruj OBA soubory: npm run db:types:refresh:throwaway",
      ).toEqual([]);
    });
  }

  test("negativní sonda: chybějící parametr, přejmenovaný parametr a OUT/DEFAULT tvary", () => {
    const sql = [
      "-- komentář s (závorkou, a čárkou)",
      "CREATE OR REPLACE FUNCTION public.f(p_a text, p_b text[] DEFAULT ARRAY['x', 'y'], OUT p_ven int, p_c jsonb DEFAULT '{\"a\": 1, \"b\": 2}'::jsonb)",
      " RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;",
    ].join("\n");
    const typy = (args: string) => `export type Database = {\n  public: {\n    Functions: {\n      f: {\n        Args: ${args}\n        Returns: number\n      }\n    }\n  }\n}\n`;
    const shoda = rozdilyArgumentu([{ soubor: "f.sql", sql }], typy("{ p_a: string; p_b?: string[]; p_c?: Json }"));
    expect(shoda).toEqual({ porovnano: 1, nezmereno: [], rozdily: [] });
    expect(rozdilyArgumentu([{ soubor: "f.sql", sql }], typy("{ p_a: string; p_b?: string[] }")).rozdily.length, "chybějící parametr").toBe(1);
    expect(rozdilyArgumentu([{ soubor: "f.sql", sql }], typy("{ p_a: string; p_b?: string[]; p_d?: Json }")).rozdily.length, "přejmenovaný").toBe(1);
    expect(rozdilyArgumentu([{ soubor: "f.sql", sql: "CREATE FUNCTION public.f(123bad) RETURNS int" }], typy("never")).nezmereno).toEqual(["f.sql"]);
  });
});

