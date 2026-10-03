/**
 * Brána A15 (ADR-004): klíč trezoru relací federovaného zdroje se NIKDY nedostane do DB.
 *
 * Broker šifruje tokeny uživatelů u zdroje klíčem FEDERATION_VAULT_KEY právě proto, že
 * tajemství v DB jsou čitelná každou relací se SQL: klíč sloupců i klíč trezoru platformy
 * se nastavují `ALTER DATABASE … SET` a posílají přes `PGOPTIONS` služby db
 * (infra/postgres/set-passwords.sh, docker-compose.coolify.yml). Kdyby se tam klíč brokeru
 * dostal, vrátila by se přesně ta vada, kvůli které žije mimo DB.
 *
 * VLASTNOST (měří se nad stromem, ne nad jedním souborem):
 *   1. v compose nese FEDERATION_VAULT_KEY JEN služba brokeru zdroje; žádná služba
 *      Postgresu (image postgres / jméno db) ho nemá v env a žádné PGOPTIONS ho nenese;
 *   2. žádné SQL ho nenastaví jako GUC (`ALTER DATABASE|ROLE|SYSTEM … SET`, `set_config`)
 *      ani nečte (`current_setting`);
 *   3. skripty infra/postgres (konfigurace DB) ho neznají vůbec.
 * Negativní sondy ve stejné bráně dokazují, že detektor podvržený řádek chytí.
 *
 * Spouští se přes: npm run test:gates -- federace-klic-trezoru-mimo-db
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";

const ROOT = process.cwd();
const KLIC = /FEDERATION_VAULT_KEY|federation_vault_key/i;
const SLUZBA_BROKERU = /source-broker/;

function soubory(adresar: string, filtr: (f: string) => boolean, hloubka = 0): string[] {
  if (hloubka > 8) return [];
  let out: string[] = [];
  for (const j of readdirSync(adresar)) {
    if (j === "node_modules" || j === ".git" || j === "dist") continue;
    const p = join(adresar, j);
    const st = statSync(p);
    if (st.isDirectory()) out = out.concat(soubory(p, filtr, hloubka + 1));
    else if (filtr(p)) out.push(p);
  }
  return out;
}

/** Nálezy v compose: klíč u služby, která není broker; klíč v env služby Postgresu; klíč v PGOPTIONS. */
export function nalezyCompose(text: string, jmeno: string): string[] {
  const doc = parse(text) as { services?: Record<string, { image?: string; environment?: unknown }> } | null;
  const vady: string[] = [];
  for (const [nazev, sluzba] of Object.entries(doc?.services ?? {})) {
    const env = sluzba?.environment;
    const polozky: Array<[string, string]> = Array.isArray(env)
      ? env.map((x) => String(x).split(/=(.*)/s).slice(0, 2) as [string, string])
      : Object.entries((env ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")]);
    const jePostgres = /postgres|pgvector/i.test(String(sluzba?.image ?? "")) || /^(db|postgres)$/.test(nazev);
    for (const [k, v] of polozky) {
      if (k === "PGOPTIONS" && KLIC.test(v)) vady.push(`${jmeno}: služba ${nazev} posílá klíč trezoru v PGOPTIONS`);
      if (!KLIC.test(k) && !KLIC.test(v)) continue;
      if (jePostgres) vady.push(`${jmeno}: služba Postgresu ${nazev} dostává klíč trezoru v env`);
      else if (!SLUZBA_BROKERU.test(nazev)) vady.push(`${jmeno}: klíč trezoru nese služba ${nazev}, která není broker zdroje`);
    }
  }
  return vady;
}

/** Nálezy v SQL: klíč trezoru jako GUC (nastavení nebo čtení). Komentáře se vynechají. */
export function nalezySql(text: string, jmeno: string): string[] {
  const bezKomentaru = text.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const vady: string[] = [];
  const vzory = [
    /ALTER\s+(DATABASE|ROLE|USER|SYSTEM)\b[^;]*\bSET\b[^;]*federation_vault/i,
    /set_config\s*\(\s*'[^']*federation_vault/i,
    /current_setting\s*\(\s*'[^']*federation_vault/i,
  ];
  for (const v of vzory) if (v.test(bezKomentaru)) vady.push(`${jmeno}: SQL pracuje s klíčem trezoru jako s GUC (${v.source.slice(0, 30)}…)`);
  return vady;
}

describe("A15: klíč trezoru relací federovaného zdroje nikdy do DB", () => {
  it("compose: klíč nese jen broker zdroje, žádná služba Postgresu, žádné PGOPTIONS", () => {
    const compose = readdirSync(ROOT).filter((f) => /^docker-compose.*\.ya?ml$/.test(f));
    expect(compose.length, "univerzum compose je prázdné — detektor je slepý").toBeGreaterThan(10);
    const vady = compose.flatMap((f) => nalezyCompose(readFileSync(join(ROOT, f), "utf8"), f));
    expect(vady).toEqual([]);
    // kotva: broker ho opravdu nese (jinak by brána prošla i bez řetězce klíče)
    expect(readFileSync(join(ROOT, "docker-compose.coolify-source-broker.yml"), "utf8")).toMatch(/FEDERATION_VAULT_KEY:\s*"\$\{FEDERATION_VAULT_KEY\}"/);
  });

  it("SQL (SoT, heals, baseline): klíč trezoru se nenastavuje ani nečte jako GUC", () => {
    const sql = soubory(join(ROOT, "aisha", "db"), (f) => f.endsWith(".sql"));
    expect(sql.length).toBeGreaterThan(500);
    const vady = sql.flatMap((f) => nalezySql(readFileSync(f, "utf8"), relative(ROOT, f)));
    expect(vady).toEqual([]);
  });

  it("infra/postgres (konfigurace DB) klíč trezoru nezná", () => {
    const infra = soubory(join(ROOT, "infra", "postgres"), () => true);
    expect(infra.length).toBeGreaterThan(0);
    const vady = infra.filter((f) => KLIC.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
    expect(vady).toEqual([]);
  });

  describe("negativní sondy: podvržený řádek MUSÍ být nález", () => {
    it("klíč v env služby Postgresu", () => {
      expect(nalezyCompose(`services:\n  db:\n    image: pgvector/pgvector:pg17\n    environment:\n      FEDERATION_VAULT_KEY: x\n`, "sonda")).toHaveLength(1);
    });
    it("klíč v PGOPTIONS", () => {
      expect(nalezyCompose(`services:\n  db:\n    image: postgres:17\n    environment:\n      PGOPTIONS: "-c app.federation_vault_key=\${FEDERATION_VAULT_KEY}"\n`, "sonda").length).toBeGreaterThan(0);
    });
    it("klíč u jiné služby než broker", () => {
      expect(nalezyCompose(`services:\n  core:\n    environment:\n      - FEDERATION_VAULT_KEY=x\n`, "sonda")).toHaveLength(1);
    });
    it("ALTER DATABASE … SET, set_config i current_setting", () => {
      expect(nalezySql(`ALTER DATABASE postgres SET app.federation_vault_key = 'x';`, "sonda")).toHaveLength(1);
      expect(nalezySql(`SELECT set_config('app.federation_vault_key', 'x', false);`, "sonda")).toHaveLength(1);
      expect(nalezySql(`SELECT current_setting('app.federation_vault_key');`, "sonda")).toHaveLength(1);
    });
    it("komentář se jménem klíče nálezem NENÍ (kotva proti planému poplachu)", () => {
      expect(nalezySql(`-- klíč FEDERATION_VAULT_KEY žije mimo DB\nSELECT 1;`, "sonda")).toEqual([]);
      expect(nalezyCompose(`services:\n  svc-source-broker:\n    environment:\n      FEDERATION_VAULT_KEY: x\n`, "sonda")).toEqual([]);
    });
  });
});
