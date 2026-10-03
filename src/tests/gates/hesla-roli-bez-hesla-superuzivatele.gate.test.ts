/**
 * Brána: hesla-roli-bez-hesla-superuzivatele
 *
 * INVARIANT: když heslo aplikační role DB do kontejneru nedorazí, role NEdostane
 * heslo superuživatele — dostane PASSWORD NULL a řekne se to nahlas. Heslo
 * superuživatele smějí mít jen role, které ho sdílejí ZÁMĚRNĚ
 * (HESLO_SUPERUZIVATELE v infra/postgres/hesla-roli.lib). Platí pro OBA
 * zapisovatele: set-passwords.sh (první initdb) i entrypoint-wrapper.sh
 * (každý další start).
 *
 * PROČ (2026-09-18/19):
 *  - oba skripty nesly `${ROLE_PASSWORD:-${POSTGRES_PASSWORD}}` u šesti rolí;
 *    konzumenti čtou svou proměnnou bez náhrady, takže heslo superuživatele
 *    nikoho nepřihlásilo — jen přidalo další účty, které ho přijímají;
 *  - wrapper roli postgres_exporter neznal, set-passwords.sh běží jen při
 *    initdb, kdy role ještě neexistuje (vzniká v heals) → heslo exporteru
 *    nenastavil NIKDO (naměřeno na instanci: role bez hesla, 942 chyb
 *    přihlášení za 2 h);
 *  - dva seznamy rolí se rozešly — proto teď jeden (hesla-roli.lib) a brána
 *    si univerzum LOGIN rolí HLEDÁ v 000_init_roles_schemas.sql a heals.sql.
 *
 * CO SE MĚŘÍ (chování, ne text):
 *  - set-passwords.sh se SPUSTÍ s podvrženým psql (zapíše argumenty i stdin);
 *  - hesla_roli_sql z knihovny (tu samou volá wrapper) se spustí v bashi;
 *  - negativní kontrola: zmutovaná knihovna s náhradou superuživatelem MUSÍ
 *    být chycena — měřidlo, které neumí říct „ne", neměří nic.
 */
import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

const ROOT = process.cwd();
const PG = path.join(ROOT, "infra/postgres");
const LIB = path.join(PG, "hesla-roli.lib");
const SUPER = "superheslo-ktere-role-mit-nesmi";

const PRACOVNI = mkdtempSync(path.join(tmpdir(), "hesla-roli-"));
afterAll(() => rmSync(PRACOVNI, { recursive: true, force: true }));

// Podvržený psql: zapíše argumenty i stdin. ⛔ Argumenty DOSLOVNĚ (`[%s]`), ne
// `%q`: ten escapuje mezery a hledaný text by v logu nebyl NIKDY.
writeFileSync(
  path.join(PRACOVNI, "psql"),
  `#!/usr/bin/env bash
log="$PSQL_LOG"
printf 'ARGS:' >> "$log"; printf ' [%s]' "$@" >> "$log"; printf '\\n' >> "$log"
if [ ! -t 0 ]; then sed 's/^/STDIN: /' >> "$log"; fi
case "$*" in *"SELECT 1 FROM pg_"*) echo 1 ;; esac
exit 0
`,
);
chmodSync(path.join(PRACOVNI, "psql"), 0o755);

// ── Univerzum: role, které se umí přihlásit, si brána HLEDÁ ─────────────────
// ⛔ `[a-z0-9_]`, ne `[a-z_]`: `n8n_app` má číslice (kontrolní vzorek níž).
function loginRole(): string[] {
  const zdroje = [path.join(PG, "000_init_roles_schemas.sql"), path.join(ROOT, "aisha/db/heals.sql")];
  const role = new Set<string>();
  for (const z of zdroje) {
    for (const m of readFileSync(z, "utf8").matchAll(/CREATE ROLE ([a-z0-9_]+)\b([^;]*);/g)) {
      if (/\bNOLOGIN\b/.test(m[2]) || !/\bLOGIN\b/.test(m[2])) continue;
      role.add(m[1]);
    }
  }
  return [...role].sort();
}

/** Seznamy z knihovny přečtené BASHEM (ne regexem nad textem). */
function zKnihovny(lib = LIB): { superuz: string[]; role: Record<string, string>; pozdni: Record<string, string> } {
  const r = spawnSync(
    "bash",
    ["-c", `. "$1"; echo "S:\${HESLO_SUPERUZIVATELE[*]}"; for p in "\${ROLE_HESLA[@]}"; do echo "R:$p"; done; for p in "\${ROLE_HESLA_POZDNI[@]}"; do echo "P:$p"; done`, "_", lib],
    { encoding: "utf8", timeout: 20_000 },
  );
  expect(r.status, r.stderr).toBe(0);
  const out = { superuz: [] as string[], role: {} as Record<string, string>, pozdni: {} as Record<string, string> };
  for (const l of r.stdout.split("\n")) {
    if (l.startsWith("S:")) out.superuz = l.slice(2).split(" ").filter(Boolean);
    const [k, v] = l.slice(2).split(":");
    if (l.startsWith("R:")) out.role[k] = v;
    if (l.startsWith("P:")) out.pozdni[k] = v;
  }
  return out;
}

const SEZNAM = zKnihovny();
const VSECHNY_PROMENNE = [...Object.values(SEZNAM.role), ...Object.values(SEZNAM.pozdni)];
const hesloRole = (role: string) => `heslo-${role}-0001`;

/** env s hesly všech rolí KROMĚ vynechaných. */
function envBez(vynech: string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: `${PRACOVNI}:${process.env.PATH}`,
    POSTGRES_USER: "postgres",
    POSTGRES_DB: "postgres",
    POSTGRES_PASSWORD: SUPER,
    VAULT_ENCRYPTION_KEY: "vault-klic-pro-test",
    COLUMN_ENCRYPTION_KEY: "sloupcovy-klic-pro-test",
    JWT_SECRET: "jwt-pro-test",
  };
  for (const [role, v] of [...Object.entries(SEZNAM.role), ...Object.entries(SEZNAM.pozdni)]) {
    if (!vynech.includes(v)) env[v] = hesloRole(role);
  }
  return env;
}

/** Které role dostaly heslo superuživatele, a které NULL — z vygenerovaného SQL. */
function rozbor(sql: string): { superuz: string[]; nul: string[] } {
  const superuz = new Set<string>();
  const nul = new Set<string>();
  for (const radek of sql.split("\n")) {
    const alter = radek.match(/ALTER ROLE ([a-z0-9_]+) WITH PASSWORD '([^']*)'/);
    if (alter && alter[2] === SUPER) superuz.add(alter[1]);
    const doBlok = radek.match(/rolname = '([a-z0-9_]+)'.*PASSWORD %L', '[a-z0-9_]+', '([^']*)'/);
    if (doBlok && doBlok[2] === SUPER) superuz.add(doBlok[1]);
    const n1 = radek.match(/ALTER ROLE ([a-z0-9_]+) WITH PASSWORD NULL/);
    if (n1) nul.add(n1[1]);
    const n2 = radek.match(/rolname = '([a-z0-9_]+)'.*PASSWORD NULL/);
    if (n2) nul.add(n2[1]);
  }
  return { superuz: [...superuz].sort(), nul: [...nul].sort() };
}

/** Wrapper cesta: hesla_roli_sql z knihovny (tu samou, kterou wrapper vkládá). */
function sqlZKnihovny(env: NodeJS.ProcessEnv, lib = LIB): { sql: string; err: string } {
  const r = spawnSync("bash", ["-c", `. "$1"; hesla_roli_sql "$POSTGRES_PASSWORD"`, "_", lib], {
    encoding: "utf8",
    env,
    timeout: 20_000,
  });
  expect(r.status, r.stderr).toBe(0);
  return { sql: r.stdout, err: r.stderr };
}

/** Initdb cesta: set-passwords.sh SPUŠTĚNÝ s podvrženým psql. */
function sqlZeSetPasswords(env: NodeJS.ProcessEnv, tag: string): { sql: string; vystup: string } {
  const log = path.join(PRACOVNI, `log-${tag}`);
  writeFileSync(log, "");
  const r = spawnSync("bash", [path.join(PG, "set-passwords.sh")], {
    encoding: "utf8",
    env: { ...env, PSQL_LOG: log },
    input: "",
    timeout: 20_000,
  });
  const vystup = `${r.stdout}${r.stderr}`;
  expect(r.status, vystup).toBe(0);
  const sql = readFileSync(log, "utf8")
    .split("\n")
    .filter((l) => l.startsWith("STDIN: ") || l.startsWith("ARGS:"))
    .map((l) => l.replace(/^STDIN: /, ""))
    .join("\n");
  return { sql, vystup };
}

describe("brána: hesla-roli-bez-hesla-superuzivatele", () => {
  it("univerzum: každá LOGIN role je v knihovně, nebo je vyjmenovaná proč ne", () => {
    const univerzum = loginRole();
    // Kontrolní vzorek hledání: role s číslicí a role z heals.
    expect(univerzum, "regex rolí minul n8n_app (číslice)").toContain("n8n_app");
    expect(univerzum, "univerzum nečte heals.sql").toContain("postgres_exporter");
    // Role mimo knihovnu ZÁMĚRNĚ: sdílejí heslo superuživatele z definice,
    // nebo jim heslo nenastavuje nikdo (nepřihlásí se heslem vůbec).
    const mimo: Record<string, string> = {
      aisha_admin: "heslo superuživatele z definice (hesla_roli_sql ho nastaví výslovně)",
      authenticator: "heslo superuživatele z definice (PostgREST)",
      aisha_replicator: "heslo mu nenastavuje nikdo — heslem se nepřihlásí, heslo superuživatele nedostane",
    };
    const pokryte = new Set([...Object.keys(SEZNAM.role), ...Object.keys(SEZNAM.pozdni), ...Object.keys(mimo)]);
    expect(univerzum.filter((r) => !pokryte.has(r)), "LOGIN role bez rozhodnutí o hesle").toEqual([]);
  });

  it("měřidlo měří: set-passwords.sh doběhl a psql dostal ALTER ROLE", () => {
    const { sql } = sqlZeSetPasswords(envBez([]), "vse");
    expect(sql).toMatch(/ALTER ROLE aisha_admin WITH PASSWORD/);
    expect(sql).toMatch(/ALTER ROLE keycloak_app WITH PASSWORD 'heslo-keycloak_app-0001'/);
    expect(sql, "exporter chybí v initdb SQL").toMatch(/rolname = 'postgres_exporter'/);
  });

  for (const cesta of ["set-passwords.sh (initdb)", "hesla_roli_sql (wrapper, každý start)"] as const) {
    const sqlPro = (vynech: string[], tag: string) =>
      cesta.startsWith("set-passwords")
        ? sqlZeSetPasswords(envBez(vynech), tag).sql
        : sqlZKnihovny(envBez(vynech)).sql;

    it(`${cesta}: se všemi hesly má heslo superuživatele jen deklarovaná množina`, () => {
      expect(rozbor(sqlPro([], "vse2")).superuz).toEqual(["aisha_admin", "authenticator"]);
    });

    it(`${cesta}: bez hesel rolí dostane heslo superuživatele jen HESLO_SUPERUZIVATELE, ostatní NULL`, () => {
      const r = rozbor(sqlPro(VSECHNY_PROMENNE, "zadne"));
      expect(r.superuz).toEqual([...SEZNAM.superuz].sort());
      const ocekavaneNull = [...Object.keys(SEZNAM.role), ...Object.keys(SEZNAM.pozdni)]
        .filter((role) => !SEZNAM.superuz.includes(role))
        .sort();
      expect(r.nul).toEqual(ocekavaneNull);
    });
  }

  it("wrapper vkládá SQL z knihovny a vlastní seznam hesel nemá", () => {
    // Kód BEZ komentářových řádků: komentář, který starý vzor jmenuje („dřív tu
    // byl `:-$RAW_POSTGRES_PASSWORD`"), není kód (naměřeno při psaní brány).
    const bezKomentaru = (t: string) => t.split("\n").filter((r) => !/^\s*#/.test(r)).join("\n");
    const w = bezKomentaru(readFileSync(path.join(PG, "entrypoint-wrapper.sh"), "utf8"));
    expect(w).toMatch(/\. "\$HESLA_ROLI_LIB"/);
    expect(w).toMatch(/HESLA_SQL="\$\(hesla_roli_sql /);
    expect(w).toMatch(/\\\\set ON_ERROR_STOP on\n\$\{HESLA_SQL\}/);
    expect(w, "wrapper nese vlastní ALTER ROLE s heslem").not.toMatch(/ALTER ROLE [a-z0-9_]+ WITH PASSWORD/);
    expect(w, "náhrada heslem superuživatele ve wrapperu").not.toMatch(/:-\$\{?RAW_POSTGRES_PASSWORD|:-\$\{POSTGRES_PASSWORD/);
    const s = bezKomentaru(readFileSync(path.join(PG, "set-passwords.sh"), "utf8"));
    expect(s, "náhrada heslem superuživatele v set-passwords.sh").not.toMatch(/:-\$\{POSTGRES_PASSWORD/);
    const d = readFileSync(path.join(PG, "Dockerfile"), "utf8");
    expect(d).toMatch(/COPY hesla-roli\.lib \/docker-entrypoint-initdb\.d\/hesla-roli\.lib/);
    expect(d).toMatch(/COPY hesla-roli\.lib \/usr\/local\/bin\/hesla-roli\.lib/);
  });

  it("chybějící heslo se ohlásí nahlas a apostrof v hesle SQL nerozbije", () => {
    const { err } = sqlZKnihovny(envBez(["POSTGRES_EXPORTER_PASSWORD"]));
    expect(err).toMatch(/POSTGRES_EXPORTER_PASSWORD není doručené/);
    const env = envBez([]);
    env.KEYCLOAK_DB_PASSWORD = "o'hara";
    expect(sqlZKnihovny(env).sql).toContain("ALTER ROLE keycloak_app WITH PASSWORD 'o''hara';");
  });

  it("NEGATIVNÍ KONTROLA: knihovna s náhradou superuživatelem je chycena", () => {
    const zlaLib = path.join(PRACOVNI, "hesla-roli-zla.lib");
    copyFileSync(LIB, zlaLib);
    const puvodni = readFileSync(zlaLib, "utf8");
    const mutovana = puvodni.replace('val="$(hr_strip_outer_quotes "${!var:-}")"', 'val="$(hr_strip_outer_quotes "${!var:-$1}")"');
    expect(mutovana, "mutace nesedí na knihovnu").not.toBe(puvodni);
    writeFileSync(zlaLib, mutovana);
    const r = rozbor(sqlZKnihovny(envBez(VSECHNY_PROMENNE), zlaLib).sql);
    expect(r.superuz.length, "zmutovaná knihovna prošla — měřidlo neumí říct ne").toBeGreaterThan(SEZNAM.superuz.length);
  });
});
