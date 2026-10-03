/**
 * Brána: `config/domains.env.example` je DOKUMENTACE tvaru, ne zdroj hodnot.
 *
 * ⛔ NAMĚŘENO 2026-09-13 na nasazené instanci. `aisha-cold-start.sh` měl smyčku „Iter 14 + 22":
 * každý klíč, který po resolveru topologie, šabloně `config/domains.env` a vaultu
 * zůstal prázdný, exportoval s hodnotou z `.example` — a hlásil jen varování
 * „filled unset keys from domains.env.example (placeholder)". Změřeno s prostředím
 * té instance (derive-domains --shell + instance-data, pak domains.env, pak .env-prod-backup):
 * doplňovala přesně CORE_MESH_HOST, EDGE_MESH_HOST, LEDGER_MESH_HOST,
 * INTEGRATION_MESH_HOST a BACKEND_MESH_HOST. Žádný z nich nečte žádný kód — šablona
 * je vyřadila už dřív (brána sablona-nema-mrtve-promenne), `.example` je držel dál.
 *
 * Táž cesta 2026-09-04 dovezla do produkce forku `NETBIRD_DOMAIN=netbird.aisha.example.com`
 * (manifest-ma-adresu-v-topologii): referenční hodnota VYPADÁ věrohodně, takže
 * neselže nahlas tam, kde chybí, ale potichu o tři kroky dál.
 *
 * CO SE MĚŘÍ (bez podprocesů):
 *   1. z `domains.env.example` nevede do prostředí žádná cesta — žádný skript ho
 *      v KÓDU (mimo komentáře) nečte, ani jménem, ani jako `${DOMAINS_FILE}.example`;
 *   2. každý klíč, který `.example` dokumentuje, má ve stromu čtenáře — univerzum
 *      čtenářů se HLEDÁ chůzí stromem, ne seznamem (jinak mine právě to, na co se
 *      zapomnělo); deklarační soubory v `config/` se za čtenáře nepočítají;
 *   3. obě sondy jdou rozsvítit — tvar do 2026-09-13 by chytily.
 *
 * Povinnost klíče drží jeho SPOTŘEBITEL (`${X:?}` v compose → preflight-compose,
 * kontrakt env-doktora), ne vzorový soubor: část klíčů je prázdná legitimně
 * (AISHA_WEB_PUBLIC_ALIASES), takže „chybí po načtení = chyba" by lhalo.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const EXAMPLE = "config/domains.env.example";

/** Řádky kódu bez komentářů — komentář není chování. */
function kodBezKomentaru(text: string, soubor: string): string[] {
  // Styl komentáře podle jazyka: `#` (shell, YAML, env), `--` (SQL), jinak JS/TS.
  const hash = /\.(sh|ya?ml|env|conf)$/.test(soubor);
  const sql = /\.sql$/.test(soubor);
  return text.split("\n").filter((r) => {
    const t = r.trim();
    if (hash) return !t.startsWith("#");
    if (sql) return !t.startsWith("--");
    return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
  });
}

/** Řádky kódu, které `domains.env.example` ČTOU (jménem nebo přes proměnnou s cestou). */
function ctouExample(text: string, soubor: string): string[] {
  return kodBezKomentaru(text, soubor).filter((r) => /(?:domains\.env|\$\{?DOMAINS_FILE\}?)\.example/.test(r));
}

/** Klíče dokumentované v `.example` (levá strana `KEY=`, bez komentářů). */
function klice(example: string): string[] {
  return example
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .map((l) => /^([A-Z][A-Z0-9_]*)=/.exec(l)?.[1])
    .filter((x): x is string => Boolean(x));
}

/** Klíče z `.example`, které v textu čtenářů nemají ani jeden výskyt. */
function bezCtenare(example: string, ctenari: string): string[] {
  return klice(example).filter((k) => !new RegExp(`\\b${k}\\b`).test(ctenari));
}

// `trash/` je archiv mrtvého kódu — jeho zmínka klíč NEOŽIVUJE. Dot-adresáře
// nástrojů (.claude s worktrees, .backup se zálohami env) by přinesly cizí kopie stromu.
const PRESKOCIT = new Set(["node_modules", ".git", ".claude", ".backup", "dist", "coverage", "docs", "trash"]);

/** Soubory stromu do hloubky — univerzum se hledá, nepíše. */
function soubory(koren: string, filtr: (cesta: string) => boolean, hloubka = 0, out: string[] = []): string[] {
  if (hloubka > 5) return out;
  for (const n of readdirSync(koren)) {
    if (PRESKOCIT.has(n) || n.startsWith(".wt-")) continue;
    const p = join(koren, n);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue; // zmizelý symlink / nečitelné — není to soubor, který by mohl číst
    }
    if (st.isDirectory()) soubory(p, filtr, hloubka + 1, out);
    else if (filtr(p)) out.push(p);
  }
  return out;
}

describe("domains.env.example není zdroj hodnot (brána)", () => {
  const example = readFileSync(join(ROOT, EXAMPLE), "utf-8");

  const skripty = soubory(join(ROOT, "scripts"), (p) => /\.(sh|mjs|js|cjs)$/.test(p) && !/\.(test|spec)\./.test(p));

  const ctenari = soubory(
    ROOT,
    (p) =>
      // Jazyky, ve kterých se env klíč ČTE (compose, shell, node, env, konfigurace
      // proxy). JSON a SQL ne: klíč prostředí se v nich nečte, jen by nafoukly
      // univerzum (naměřeno: 47 MB / 2,9 s proti 14 MB / 0,6 s).
      /\.(ya?ml|sh|mjs|cjs|js|ts|env|conf)$/.test(p) &&
      !/\.(test|spec)\./.test(p) &&
      !p.includes(`${join(ROOT, "src/tests")}/`) &&
      // Deklarace (šablona, .example, profily) nejsou ČTENÁŘI — jinak by klíč
      // „četla" šablona, která ho sama jen deklaruje.
      !p.startsWith(`${join(ROOT, "config")}/`),
  )
    .map((p) => {
      try {
        return kodBezKomentaru(readFileSync(p, "utf-8"), p).join("\n");
      } catch {
        return ""; // nečitelné = neměřeno; sonda níž hlídá, že univerzum není prázdné
      }
    })
    .join("\n");

  test("sonda má co měřit — .example něco dokumentuje, skripty i čtenáři se našli", () => {
    expect(klice(example).length).toBeGreaterThan(20);
    expect(skripty.length).toBeGreaterThan(100);
    expect(ctenari.length).toBeGreaterThan(100_000);
  });

  test("1. žádný skript domains.env.example v kódu nečte", () => {
    const nalezy = skripty.flatMap((p) =>
      ctouExample(readFileSync(p, "utf-8"), p).map((r) => `${p.replace(`${ROOT}/`, "")}: ${r.trim()}`),
    );
    expect(
      nalezy,
      "Skript čte domains.env.example — to je fallback na REFERENČNÍ hodnotu (example.com), která\n" +
        "neselže tam, kde hodnota chybí, ale projde do nasazení. Hodnotu DEKLARUJ (profil, vault,\n" +
        "overlay instance); chybějící nech selhat u spotřebitele (`${X:?}`).",
    ).toEqual([]);
  });

  test("2. každý klíč v domains.env.example má ve stromu čtenáře", () => {
    expect(
      bezCtenare(example, ctenari),
      "Klíč v .example nikdo nečte — mrtvá dokumentace, kterou jiný nástroj snadno vezme za kontrakt.\n" +
        "Odstraň ho (a ověř `git grep`), nebo doplň čtenáře, pokud je to skutečný vstup.",
    ).toEqual([]);
  });

  test("3. obě sondy jdou rozsvítit — tvar do 2026-09-13 by chytily", () => {
    const staraSmycka = [
      '  domains_example="${DOMAINS_FILE}.example"',
      '  if [ -f "$domains_example" ]; then',
      '    done < <(grep -E "^[A-Z_][A-Z0-9_]*=" "$domains_example")',
      "  fi",
      '  # komentář o domains.env.example se nepočítá',
    ].join("\n");
    expect(ctouExample(staraSmycka, "scripts/aisha-cold-start.sh")).toHaveLength(1);
    expect(ctouExample('const x = readFileSync("config/domains.env.example");', "scripts/x.mjs")).toHaveLength(1);
    expect(ctouExample("// čte domains.env.example", "scripts/x.mjs")).toEqual([]);

    const staryExample = "MESH_TLD=mesh.example.internal\nCORE_MESH_HOST=core.mesh.example.internal   # role\n";
    expect(bezCtenare(staryExample, "echo ${MESH_TLD}")).toEqual(["CORE_MESH_HOST"]);
  });
});
