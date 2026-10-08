import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * Co DB lane staví a spouští, to ji musí umět spustit.
 *
 * ⛔ PROČ EXISTUJE (naměřeno 2026-09-18)
 * PR #362 měnil jen `infra/postgres/set-passwords.sh` — skript, který běží při
 * prvním startu DB kontejneru. CI byla zelená, ale `Cold-start: apply` i
 * `Governance: DB & Security` se PŘESKOČILY: filtr `DB_CHANGE` v detekci znal
 * `aisha/db/…`, ne obsah obrazu, který cold-start job sám staví
 * (`docker build … infra/postgres`). Změna startu DB tak stála jen na tom, že ji
 * člověk ověřil lokálně.
 *
 * ⭐ UNIVERZUM SE BERE Z CI, NEPÍŠE SE SEM
 * Úlohy, které se spouštějí podle `db_change`, samy říkají, co ze stromu berou:
 * kontext a Dockerfile každého `docker build` a soubory, které čtou přesměrováním
 * vstupu (`… < infra/postgres/000_init_roles_schemas.sql`). Každý takový soubor
 * musí rozsvítit `DB_CHANGE` — a stejně tak vlastní kontrolu směrování
 * (`EXPECT_DB`), jinak by si detekce protiřečila.
 *
 * ⚠️ Adresář se prochází přes `fs`, ne `git ls-files`: brána tak nespouští
 * podproces (rohatka drah), a navíc vidí i soubor, který ještě není v gitu —
 * přesně ten, který se do obrazu dostane při příští stavbě.
 *
 * ⛔ 2026-09-19 (review #363, ověřeno): měřidlo znalo jen `docker build` a `<`.
 * DB lane ale čte strom i přes `psql -f aisha/db/seed.compiled.sql`,
 * `node …/postgres-major.mjs` (import v `node -e` — určuje verzi obrazu),
 * `node scripts/db/db-manager/access.mjs` (governance) a `npx vitest run …`.
 * Nic z toho `DB_CHANGE` nerozsvítilo — táž vada o patro výš. Měřidlo teď zná
 * i tyhle tvary a je FAIL-CLOSED: souborový argument s `$`, který nejde
 * přečíst, nezmizí, ale skončí v `neoveritelne` a musí být vyjmenovaný.
 * A umí říct „ne": negativní kontrola níž maže `infra/postgres/` z regexu
 * ci.yml a čeká, že brána zčervená.
 */
const ROOT = join(__dirname, "../../..");
const CI_PATH = join(ROOT, ".github/workflows/ci.yml");
const CI_TEXT = readFileSync(CI_PATH, "utf8");
// Směrování podle cest je od 2026-09-25 JEDEN DOMOV mimo ci.yml (volá ho CI i pre-push hook).
const SMEROVANI_PATH = join(ROOT, "scripts/ci/zmenene-cesty.sh");
const SMEROVANI_TEXT = readFileSync(SMEROVANI_PATH, "utf8");

type Krok = { name?: string; run?: unknown };
type Job = { if?: unknown; steps?: Krok[] };
const CI = parseYaml(CI_TEXT) as { jobs: Record<string, Job> };

/** Vzor filtru `DB_CHANGE` z detekce (text ERE) — ten, podle kterého CI opravdu směruje. */
function dbChangeVzor(text = SMEROVANI_TEXT): string {
  const radek = text.split("\n").find((r) => /grep -qE '.*' <<< "\$CHANGED" && DB_CHANGE=true/.test(r));
  if (!radek) throw new Error("ve scripts/ci/zmenene-cesty.sh není řádek `grep -qE … && DB_CHANGE=true` — měřidlo přestalo sedět");
  const m = radek.match(/grep -qE '([^']+)'/);
  if (!m) throw new Error(`nečitelný vzor DB_CHANGE: ${radek.trim()}`);
  return m[1];
}
const dbChangeRegex = (text = SMEROVANI_TEXT) => new RegExp(dbChangeVzor(text));

/** Shellový `case` vzor → regex (jen `*`; jiné metaznaky shellu tu nejsou). */
const caseNaRegex = (v: string) => new RegExp(`^${v.replace(/[.+^${}()[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);

/** Vzory řádku `case … ) <PŘÍZNAK>=true ;;` / `) echo "  $f" ;;`. */
function caseVzory(konec: RegExp): string[] {
  const radek = SMEROVANI_TEXT.split("\n").find((r) => konec.test(r));
  if (!radek) throw new Error(`ve scripts/ci/zmenene-cesty.sh není řádek ${konec}`);
  return radek.trim().replace(konec, "").split("|");
}
const expectDbVzory = () => caseVzory(/\)\s*EXPECT_DB=true ;;$/).map(caseNaRegex);

/**
 * DB lane = úlohy, které spouští JEN `db_change` (případně `security_change`).
 * Úlohy, které spouští i jiný příznak (deploy-core přes `app`, surface-contract
 * přes `surfaces`, overlay-gates…), čtou vstupy, které hlídá ten jiný příznak —
 * do univerza DB_CHANGE nepatří.
 */
function dbUlohy(): Array<[string, Job]> {
  return Object.entries(CI.jobs).filter(([, j]) => {
    const prizn = new Set([...String(j.if ?? "").matchAll(/needs\.detect\.outputs\.([a-z_]+)/g)].map((m) => m[1]));
    prizn.delete("already_verified");
    return prizn.has("db_change") && [...prizn].every((p) => p === "db_change" || p === "security_change");
  });
}

/** Příkazy z `run:` kroků — bez komentářů, s pospojovanými `\`. */
function prikazy(job: Job): string[] {
  return (job.steps ?? [])
    .map((k) => (typeof k.run === "string" ? k.run : ""))
    .join("\n")
    .replace(/\\\n\s*/g, " ")
    .split("\n")
    .map((r) => r.trim())
    .filter((r) => r && !r.startsWith("#"));
}

function soubory(cesta: string): string[] {
  const abs = join(ROOT, cesta);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [cesta];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) =>
    soubory(relative(ROOT, join(abs, e.name))),
  );
}

/**
 * Co ze stromu úloha bere:
 *  - kontext + Dockerfile `docker build`,
 *  - soubory čtené přes `<` a přes `-f <soubor>` (psql),
 *  - skript za `node`/`bash`/`sh` a testy za `vitest run`,
 *  - relativní import (`from "./…"`) uvnitř `node -e`.
 * `"$GITHUB_WORKSPACE/…"` se čte jako cesta ve stromu. Jiný souborový argument
 * s `$` se NEZAHODÍ — jde do `neoveritelne` (fail-closed).
 */
function vstupyUlohy(radky: string[]): { vstupy: string[]; neoveritelne: string[] } {
  const out: string[] = [];
  const neoveritelne: string[] = [];
  const cesta = (t: string | undefined) => {
    if (!t) return;
    const c = t.replace(/^["']|["']$/g, "").replace(/^\$\{?GITHUB_WORKSPACE\}?\//, "");
    if (c === "-" || c.startsWith("-") || c.startsWith("/")) return;
    if (c.includes("$")) { neoveritelne.push(c); return; }
    out.push(c.replace(/\/$/, ""));
  };
  for (const r of radky) {
    const tokeny = r.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    if (/(^|[;&|]\s*)docker\s+(buildx\s+)?build\b/.test(r)) {
      const kontext = tokeny[tokeny.length - 1];
      if (kontext && kontext !== ".") cesta(kontext);
    }
    // `-f` je soubor jen za psql a za `docker build` — `docker rm -f <kontejner>`,
    // `curl -f`, `rm -f` ne (naměřeno: jméno kontejneru `coldstart-${{…}}` se
    // tvářilo jako neověřitelný soubor).
    const odPsql = tokeny.findIndex((t) => /(^|\/)psql$/.test(t));
    const odBuild = tokeny.findIndex((t, i) => t === "build" && /^(docker|buildx)$/.test(tokeny[i - 1] ?? ""));
    const odKdy = [odPsql, odBuild].filter((i) => i >= 0);
    tokeny.forEach((t, i) => {
      if ((t === "-f" || t === "--file") && odKdy.some((od) => i > od)) cesta(tokeny[i + 1]);
      if (/^(node|bash|sh)$/.test(t) && tokeny[i + 1] && !tokeny[i + 1].startsWith("-")) cesta(tokeny[i + 1]);
    });
    const vitest = r.match(/\bvitest\s+run\s+(.*)$/);
    if (vitest) (vitest[1].match(/"[^"]*"|'[^']*'|\S+/g) ?? []).filter((t) => !t.startsWith("-")).forEach(cesta);
    for (const m of r.matchAll(/<\s+("?[A-Za-z0-9_./${}-]+"?)/g)) cesta(m[1]);
    for (const m of r.matchAll(/from\s+["']\.\/([^"']+)["']/g)) cesta(m[1]);
  }
  return { vstupy: [...new Set(out)].sort(), neoveritelne: [...new Set(neoveritelne)].sort() };
}

/**
 * Vstupy DB lane, které ZÁMĚRNĚ nerozsvěcují `DB_CHANGE` — každý s důvodem.
 * Společná infrastruktura CI: volá ji každá úloha se stavbou/npm, takže její
 * změna neprojde neměřená, a DB lane by kvůli ní běžela u každého PR.
 */
const MIMO_DB: Record<string, string> = {
  "scripts/ci/npm-ci.sh": "společná instalace závislostí všech úloh (app=true přes scripts/*)",
  "scripts/ci/repair-native-deps.sh": "společná oprava nativních modulů všech úloh (app=true přes scripts/*)",
  "scripts/ci/registry-proxy-guard.sh": "stráž REGISTRY_PROXY před KAŽDOU stavbou obrazu (app=true přes scripts/*)",
};
/** Souborové argumenty s `$`, které vědomě nejdou přečíst — vyjmenované. */
const NEOVERITELNE_ZNAME: Record<string, string> = {};

describe("obsah obrazu DB spouští cold-start", () => {
  const regex = dbChangeRegex();
  const kontrola = expectDbVzory();
  const ulohy = dbUlohy();
  const mereni = ulohy.map(([, j]) => vstupyUlohy(prikazy(j)));
  const vstupy = [...new Set(mereni.flatMap((m) => m.vstupy))];
  const neoveritelne = [...new Set(mereni.flatMap((m) => m.neoveritelne))].sort();
  const univerzum = [...new Set(vstupy.flatMap(soubory))].filter((f) => !(f in MIMO_DB)).sort();
  const slepeV = (re: RegExp) => univerzum.filter((f) => !re.test(f));

  it("měřidlo umí říct ne (syntetické řádky)", () => {
    const v = (r: string) => vstupyUlohy([r]).vstupy;
    expect(v("docker build -f infra/x/Dockerfile -t y infra/x")).toEqual(["infra/x", "infra/x/Dockerfile"]);
    expect(vstupyUlohy(['docker rm -f "coldstart-${{ github.run_id }}"']), "rm -f <kontejner> není soubor")
      .toEqual({ vstupy: [], neoveritelne: [] });
    expect(v('psql "$U" -f - < infra/x/init.sql')).toEqual(["infra/x/init.sql"]);
    expect(v('psql "$AISHA_DB_URL" -v ON_ERROR_STOP=1 -q -f aisha/db/seed.compiled.sql')).toEqual(["aisha/db/seed.compiled.sql"]);
    expect(v("node scripts/db/db-manager/access.mjs --static")).toEqual(["scripts/db/db-manager/access.mjs"]);
    expect(v('bash "$GITHUB_WORKSPACE/scripts/ci/npm-ci.sh"')).toEqual(["scripts/ci/npm-ci.sh"]);
    expect(v("npx vitest run src/tests/db/a.test.ts src/tests/db/b.test.ts")).toEqual(["src/tests/db/a.test.ts", "src/tests/db/b.test.ts"]);
    expect(v(`PG=$(node --input-type=module -e 'import {x} from "./scripts/lib/postgres-major.mjs"; console.log(x())')`))
      .toEqual(["scripts/lib/postgres-major.mjs"]);
    expect(v('echo "docker build se tu jen zmiňuje"')).toEqual([]);
    expect(vstupyUlohy(['bash "$SKRIPT"']).neoveritelne, "cesta s $ se nesmí tiše zahodit").toEqual(["$SKRIPT"]);
    expect(regex.test("docs/README.md"), "DB_CHANGE nesmí rozsvítit dokumentaci").toBe(false);
  });

  it("vzor ze směrovače je ERE, který JS čte stejně (žádné POSIX třídy ani \\<)", () => {
    const vzor = dbChangeVzor();
    expect(vzor, "`[[:…:]]` by JS RegExp přeložil tiše jinak").not.toContain("[[:");
    expect(vzor, "`\\<`/`\\>` (hranice slova v GNU grep) JS nezná").not.toMatch(/\\[<>]/);
  });

  it("NEGATIVNÍ KONTROLA: směrovač bez infra/postgres/ v DB_CHANGE brána chytí", () => {
    const zmutovane = SMEROVANI_TEXT.replace("|infra/postgres/)' <<< \"$CHANGED\" && DB_CHANGE=true", ")' <<< \"$CHANGED\" && DB_CHANGE=true");
    expect(zmutovane, "mutace nesedí na zmenene-cesty.sh — negativní kontrola by neměřila nic").not.toBe(SMEROVANI_TEXT);
    const slepe = slepeV(dbChangeRegex(zmutovane));
    expect(slepe.some((f) => f.startsWith("infra/postgres/")), "zmutovaný regex prošel — měřidlo neumí říct ne").toBe(true);
  });

  it("souborové argumenty s $ jsou vyjmenované (fail-closed)", () => {
    expect(neoveritelne.filter((c) => !(c in NEOVERITELNE_ZNAME)), "vstup DB lane, který brána nepřečte").toEqual([]);
  });

  it("univerzum není prázdné — DB lane opravdu staví obraz ze stromu", () => {
    expect(ulohy.map(([id]) => id).sort(), "DB lane = cold-start + governance").toEqual(["coldstart-db-gate", "governance-gate"]);
    expect(vstupy.length, "DB lane nestaví ani nečte nic ze stromu — měřilo by se prázdno").toBeGreaterThan(0);
    expect(univerzum.length).toBeGreaterThan(0);
  });

  it("každý soubor, který DB lane staví nebo čte, rozsvítí DB_CHANGE", () => {
    // Kontrolní vzorky univerza: vstupy, které stará verze měřidla neviděla.
    for (const f of ["aisha/db/seed.compiled.sql", "scripts/lib/postgres-major.mjs", "scripts/db/db-manager/access.mjs"]) {
      expect(univerzum, `měřidlo nevidí ${f}`).toContain(f);
    }
    const slepe = slepeV(regex);
    expect(
      slepe,
      "Tyhle soubory DB lane používá, ale jejich změna ji NESPUSTÍ — CI by ji přeskočila\n" +
        "a změna startu DB by prošla neověřená (PR #362, 2026-09-18). Doplň cestu do\n" +
        "`grep -qE … && DB_CHANGE=true` v ci.yml:\n  " + slepe.join("\n  "),
    ).toEqual([]);
  });

  it("vlastní kontrola směrování (EXPECT_DB) je vidí taky", () => {
    const slepe = univerzum.filter((f) => !kontrola.some((v) => v.test(f)));
    expect(
      slepe,
      "EXPECT_DB je druhé okénko na tytéž cesty; kde chybí, detekce si při rozbitém\n" +
        "regexu neprotiřečí a chyba směrování projde tiše:\n  " + slepe.join("\n  "),
    ).toEqual([]);
  });

  it("diagnostický výpis ukáže každou cestu, kterou některá kontrola EXPECT_* vyžaduje", () => {
    // Třetí místo s týmiž cestami: když ROUTING_BUG vyskočí, výpis má ukázat
    // PROČ. Vzor, který kontrola zná a výpis ne, by chybu ohlásil bez důvodu.
    const vypis = caseVzory(/\)\s*echo " {2}\$f" ;;$/);
    const pokryto = (v: string) =>
      vypis.includes(v) || vypis.some((q) => q.endsWith("/*") && v.startsWith(q.slice(0, -1)));
    const expectVzory = SMEROVANI_TEXT.split("\n")
      .filter((r) => /\)\s*EXPECT_[A-Z_]+=true ;;$/.test(r))
      .flatMap((r) => r.trim().replace(/\)\s*EXPECT_[A-Z_]+=true ;;$/, "").split("|"));
    expect(expectVzory.length, "měřidlo nenašlo žádnou kontrolu EXPECT_*").toBeGreaterThan(3);
    expect(expectVzory.filter((v) => !pokryto(v)), "vzory kontroly, které diagnostika nevypíše").toEqual([]);
  });
});
