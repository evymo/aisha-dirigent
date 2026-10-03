/**
 * Tajemství se NEDORUČUJE jako GUC Postgresu — brána na TŘÍDU.
 *
 * ⛔ NAMĚŘENO 2026-09-25 na dočasné DB z infra/postgres (produkční příkaz,
 * sentinelové klíče): `ALTER DATABASE postgres SET app.column_encryption_key /
 * app.settings.vault_encryption_key / app.settings.jwt_secret` přečetla KAŽDÁ
 * role — 11 login rolí i anon/authenticated/service_role — přes current_setting()
 * i přes pg_db_role_setting (sdílený katalog, tedy i z jiné databáze clusteru).
 * PostgREST `PGRST_APP_SETTINGS_*` je navíc vkládal do KAŽDÉHO požadavku: funkce
 * zavolaná jako anon přes /rpc je viděla. Vlastní GUC v Postgresu omezit nejde,
 * takže GUC není místo pro tajemství — ať přijde odkudkoli.
 *
 * Vlastnost: hodnota nastavení Postgresu se nesmí skládat z proměnné třídy
 * „tajemství" a tajně pojmenované VLASTNÍ nastavení (jméno s tečkou — app.*,
 * request.* …, tedy to neomezitelné) se nesmí nastavit vůbec: proměnná = únik,
 * literál = tajemství natvrdo, výraz (format(… %L, klíč)) = únik přes SQL.
 * Povolený je jen RESET. Jádrová nastavení Postgresu (bez tečky, např.
 * password_encryption) tajemství nenesou a pravidlo o jménu se jich netýká.
 * Tvary, kudy GUC vzniká:
 *   - SQL `ALTER DATABASE|ROLE|USER|SYSTEM … SET <jméno> = / TO <hodnota>`
 *   - SQL `set_config('<jméno>', <hodnota>, …)`
 *   - libpq `PGOPTIONS` s `-c <jméno>=<hodnota>`
 *   - PostgREST `PGRST_APP_SETTINGS_<JMÉNO>` (= app.settings.<jméno> per požadavek)
 * Třída se pozná podle JMÉNA (proměnné nebo nastavení), ne podle seznamu —
 * nový klíč se stejným tvarem vady spadne sám, bez údržby výjimek.
 *
 * Doplňuje: klice-sifrovani-doruceni (kontrakt souboru), test:db:tajemstvi
 * (čitelnost pod každou rolí na skutečné DB).
 *
 * Spouští se přes: npm run test:gates
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

/** Kořen stromu: jinak cwd. Přepsání slouží k předvedení červené nad starším stromem. */
const ROOT = process.env.AISHA_BRANA_KOREN || process.cwd();

const KORENY = ["infra", "scripts", "services", "packages", "docker", "config", "aisha/db/sql", "aisha/db/heals.sql", ".forgejo", ".github"];
const PRIPONY = /\.(sh|bash|ya?ml|mjs|cjs|js|ts|sql|conf|env|lib)$|(^|\/)Dockerfile[^/]*$/;
const VYNECH = /(^|\/)(node_modules|dist|build|coverage|\.git)(\/|$)|(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[cm]?[jt]s$|\.md$/;

const TAJNE_JMENO = /(secret|passw|passwd|token|private|credential|mnemonic|encryption|(^|[_.])key($|[_.])|api_?key|signing)/i;

/** Jména proměnných interpolovaných v hodnotě: ${VAR…}, $VAR, ${expr} v JS, :'var' v psql. */
export function interpolovanaJmena(hodnota: string): string[] {
  const jmena: string[] = [];
  for (const m of hodnota.matchAll(/\$\{\s*([A-Za-z_][\w.]*)/g)) jmena.push(m[1].split(".").pop()!);
  for (const m of hodnota.matchAll(/\$([A-Za-z_]\w*)/g)) jmena.push(m[1]);
  for (const m of hodnota.matchAll(/:['"]?([A-Za-z_]\w*)['"]?/g)) if (/^:['"]/.test(m[0])) jmena.push(m[1]);
  return jmena;
}

export type Nalez = { radek: number; tvar: string; nastaveni: string; proc: string };

function posud(tvar: string, nastaveni: string, hodnota: string, radek: number, out: Nalez[]) {
  const vlastni = nastaveni.includes("."); // app.*, request.* … — vlastní GUC, nejde omezit
  if (vlastni && TAJNE_JMENO.test(nastaveni)) {
    out.push({ radek, tvar, nastaveni, proc: "tajně pojmenované vlastní nastavení dostává hodnotu (povolený je jen RESET)" });
    return;
  }
  const tajnaPromenna = interpolovanaJmena(hodnota).find((j) => TAJNE_JMENO.test(j));
  if (tajnaPromenna) out.push({ radek, tvar, nastaveni, proc: `hodnota nese proměnnou ${tajnaPromenna}` });
}

/** Najde v textu všechna místa, kde by tajemství teklo do GUC. */
export function najdiTajemstviVGuc(text: string): Nalez[] {
  const out: Nalez[] = [];
  const radky = text.split("\n");
  radky.forEach((l, i) => {
    const radek = i + 1;
    // SQL ALTER … SET <jméno> =|TO <hodnota> (v rámci jednoho příkazu na řádku)
    for (const m of l.matchAll(/ALTER\s+(?:DATABASE|ROLE|USER|SYSTEM)\b[^;]*?\bSET\s+([A-Za-z_][\w.]*)\s*(?:=|\bTO\b)\s*([^;]*)/gi)) {
      posud("ALTER … SET", m[1], m[2], radek, out);
    }
    // SQL set_config('<jméno>', <hodnota>, …)
    for (const m of l.matchAll(/set_config\s*\(\s*'([\w.]+)'\s*,\s*([^,]+),/gi)) {
      posud("set_config", m[1], m[2], radek, out);
    }
    // PGOPTIONS=… / PGOPTIONS: "…" s -c jméno=hodnota
    if (/PGOPTIONS/.test(l)) {
      for (const m of l.matchAll(/-c\s*([A-Za-z_][\w.]*)=(\S+)/g)) posud("PGOPTIONS", m[1], m[2], radek, out);
    }
    // PostgREST app settings: PGRST_APP_SETTINGS_X: hodnota | - PGRST_APP_SETTINGS_X=hodnota
    const pg = l.match(/PGRST_APP_SETTINGS_([A-Z0-9_]+)\s*[:=]\s*(.*)$/);
    if (pg) posud("PGRST_APP_SETTINGS", `app.settings.${pg[1].toLowerCase()}`, pg[2], radek, out);
  });
  return out;
}

function soubory(): string[] {
  const out: string[] = [];
  const projdi = (abs: string) => {
    const rel = relative(ROOT, abs);
    if (VYNECH.test(rel)) return;
    const st = statSync(abs);
    if (st.isDirectory()) {
      for (const d of readdirSync(abs)) projdi(join(abs, d));
    } else if (PRIPONY.test(rel)) {
      out.push(rel);
    }
  };
  for (const k of KORENY) if (existsSync(join(ROOT, k))) projdi(join(ROOT, k));
  for (const f of readdirSync(ROOT)) if (/^(docker-compose[^/]*\.ya?ml|Dockerfile[^/]*)$/.test(f)) out.push(f);
  return out.sort();
}

describe("tajemství se nedoručuje jako GUC Postgresu", () => {
  it("detektor pozná každý tvar vady (mutace) a nechá literály i netajné proměnné", () => {
    const vady = [
      `ALTER DATABASE postgres SET app.column_encryption_key = '\${COLUMN_ENCRYPTION_KEY}';`,
      `    ALTER DATABASE postgres SET app.settings.jwt_secret = '\${JWT_SECRET}';`,
      `ALTER ROLE authenticator SET app.x TO '\${SOME_TOKEN}';`,
      `ALTER DATABASE postgres SET app.settings.vault_encryption_key = '\${VAULT_KEY}';`,
      `SELECT set_config('app.settings.jwt_secret', '\${jwt}', false);`,
      `      PGOPTIONS: "-c app.settings.vault_encryption_key=\${VAULT_ENCRYPTION_KEY} -c app.column_encryption_key=\${COLUMN_ENCRYPTION_KEY}"`,
      `export PGOPTIONS="-c app.settings.vault_encryption_key=\${VAULT_ENCRYPTION_KEY}"`,
      `      PGRST_APP_SETTINGS_JWT_SECRET: \${JWT_SECRET}`,
      `      PGRST_APP_SETTINGS_VAULT_ENCRYPTION_KEY: \${VAULT_ENCRYPTION_KEY}`,
      "ALTER DATABASE postgres SET app.api_key = '${process.env.OPENAI_API_KEY}'",
      "  EXECUTE format('ALTER DATABASE postgres SET app.column_encryption_key = %L', public.aisha_column_encryption_key());",
      "ALTER DATABASE postgres SET app.settings.jwt_secret = 'natvrdo-zapsany-literal';",
      `ALTER DATABASE postgres SET app.nastaveni_sluzby = '\${REDIS_PASSWORD}';`,
    ];
    for (const v of vady) expect(najdiTajemstviVGuc(v).length, `detektor musí chytit: ${v}`).toBeGreaterThan(0);

    const ne = [
      `PGOPTIONS="-c role=service_role" psql "$AISHA_DB_URL" -q -f "$f"`,
      "env: { ...process.env, PGOPTIONS: `-c role=${role}` },",
      `PGOPTIONS: "--client-min-messages=warning"`,
      `ALTER ROLE aisha_admin WITH PASSWORD '\${POSTGRES_PASSWORD}';`,
      `ALTER DATABASE postgres RESET app.settings.jwt_secret;`,
      `ALTER DATABASE postgres SET timezone TO 'UTC';`,
      `      PGRST_APP_SETTINGS_JWT_EXP: \${JWT_EXP:-3600}`,
      `      PGRST_JWT_SECRET: \${JWT_SECRET}`,
      `ALTER SYSTEM SET password_encryption = 'scram-sha-256';`,
      `SELECT set_config('request.jwt.claims', \${claims}, true);`,
    ];
    for (const v of ne) expect(najdiTajemstviVGuc(v), `detektor nesmí hlásit: ${v}`).toEqual([]);
  });

  it("žádný soubor stromu nedoručuje tajemství jako GUC", () => {
    const vse = soubory();
    // Kontrolní vzorek: sken musí skutečně vidět místa, kde se GUC dřív plnil.
    expect(vse, "sken neviděl infra/postgres/entrypoint-wrapper.sh — brána by byla slepá").toContain("infra/postgres/entrypoint-wrapper.sh");
    expect(vse, "sken neviděl docker-compose.coolify.yml — brána by byla slepá").toContain("docker-compose.coolify.yml");

    const nalezy: string[] = [];
    for (const rel of vse) {
      const text = readFileSync(join(ROOT, rel), "utf8");
      for (const n of najdiTajemstviVGuc(text)) nalezy.push(`${rel}:${n.radek} [${n.tvar}] ${n.nastaveni} — ${n.proc}`);
    }
    expect(
      nalezy,
      "Tajemství teče do GUC Postgresu. Vlastní GUC přečte KAŽDÁ role přes current_setting() i pg_db_role_setting " +
        "(naměřeno 2026-09-25) a PGRST_APP_SETTINGS ho vloží do každého požadavku. Klíče doručuj souborem " +
        "(infra/postgres/entrypoint-wrapper.sh → /run/aisha-keys, čte SECURITY DEFINER helper bez grantu):\n" +
        nalezy.join("\n"),
    ).toEqual([]);
  });
});
