/**
 * Brána: heslo databáze nejde do argv psql — a do anon-čitelného záznamu migrace
 * se nedostane ani odjinud.
 *
 * ⛔ NÁLEZ 2026-09-23 (obhlídka forku, změřeno READ ONLY na jeho produkci):
 * padlý seed vypsal do logu kontejneru migrate
 *     ❌ Seed failed: Command failed: psql postgresql://aisha_admin:<HESLO>@…
 * `execFileSync` skládá `error.message` z CELÉHO příkazu, adresa s heslem byla
 * v argv. Entrypoint migrate ukládá konec výstupu do `public.migration_log_dump`,
 * kterou záměrně čte `anon` přes veřejné PostgREST (kanál cold-startu). Na té
 * produkci ležely 2 řádky z 23 s heslem administrátorské role DB — čitelné bez
 * přihlášení.
 *
 * Měří se tři vrstvy, protože každá brání jiné cestě:
 *   1. CHOVÁNÍ: seed s falešným psql, které selže BEZ stderr (přesně případ, kdy
 *      výpis sahá po `err.message`) — kanárkové heslo nesmí být ve výstupu ani
 *      v argv, a psql ho přitom musí dostat (jinak by oprava „fungovala" tím,
 *      že se nepřipojí).
 *   2. TŘÍDA: žádný volající ve scripts/ nepředá psql adresu v argv. Univerzum se
 *      HLEDÁ ve stromu, ne ze seznamu — nový skript by jinak vadu vrátil.
 *   3. POJISTKA: výraz, kterým entrypoint maskuje výstup před zápisem, se SPUSTÍ
 *      na vzorku a musí dát totéž co bezHesla() — dvě kopie jednoho pravidla se
 *      jinak tiše rozejdou.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, it } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { bezHesla, psqlPripojeni } from "../../../scripts/db/lib/psql-pripojeni.mjs";

const ROOT = process.cwd();

describe("psqlPripojeni: heslo do prostředí, cíl beze změny", () => {
  it("adresa s heslem → argv bez hesla, PGPASSWORD s heslem (i zakódovaným)", () => {
    const r = psqlPripojeni("postgresql://aisha_admin:KAN%40AREK@db.invalid:5432/postgres?sslmode=disable", {});
    expect(r.cil).toBe("postgresql://aisha_admin@db.invalid:5432/postgres?sslmode=disable");
    expect(r.env.PGPASSWORD).toBe("KAN@AREK");
  });

  it("heslo v parametrech URI se přesune taky", () => {
    const r = psqlPripojeni("postgresql://u@h/d?password=KANAREK&sslmode=require", {});
    expect(r.cil).not.toMatch(/KANAREK/);
    expect(r.env.PGPASSWORD).toBe("KANAREK");
  });

  it("adresa bez hesla → beze změny, PGPASSWORD se nevnucuje", () => {
    const r = psqlPripojeni("postgres://u@h:5432/d", {});
    expect(r.cil).toBe("postgres://u@h:5432/d");
    expect(r.env.PGPASSWORD).toBeUndefined();
  });

  it("conninfo s password= a chybějící adresa → odmítne (nehádá)", () => {
    expect(() => psqlPripojeni("host=h password=x", {})).toThrow(/password=/);
    expect(() => psqlPripojeni("", {})).toThrow(/nehádá/);
  });

  it("bezHesla maskuje až k poslednímu @ v tokenu a nic jiného nemění", () => {
    expect(bezHesla("psql postgresql://aisha_admin:ab@cd@db:5432/x -f y; kontakt a@b.cz")).toBe(
      "psql postgresql://aisha_admin:***@db:5432/x -f y; kontakt a@b.cz",
    );
  });
});

describe("seed: padlý psql nevypíše heslo (chování, falešné psql)", () => {
  it("psql selže bez stderr → heslo není ve výstupu ani v argv, psql ho dostane prostředím", () => {
    const dir = mkdtempSync(join(tmpdir(), "heslo-db-brana-"));
    try {
      const kanarek = `KANAREK${randomBytes(6).toString("hex")}`;
      // Falešné psql: zapíše, co dostalo, a selže BEZ stderr — tehdy výpis
      // chyby sahá po `err.message`, tedy po celém příkazu.
      writeFileSync(
        join(dir, "psql"),
        `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/argv"\nprintf '%s' "\${PGPASSWORD:-}" > "${dir}/pgpassword"\nexit 1\n`,
      );
      chmodSync(join(dir, "psql"), 0o755);
      const env: NodeJS.ProcessEnv = {
        PATH: `${dir}:${process.env.PATH ?? ""}`,
        HOME: process.env.HOME ?? dir,
        AISHA_DB_URL: `postgresql://aisha_admin:${kanarek}@db.invalid:5432/postgres`,
      };
      const r = spawnSync(process.execPath, [join(ROOT, "scripts/db/seed.mjs")], {
        cwd: ROOT,
        env,
        encoding: "utf-8",
        timeout: 30_000,
      });
      const vystup = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      expect(r.status, vystup.slice(-600)).toBe(1);
      expect(vystup, "seed se musí k psql opravdu dostat").toMatch(/Seed failed/);
      expect(vystup.includes(kanarek), "heslo DB se objevilo ve výstupu seedu").toBe(false);

      const argv = readFileSync(join(dir, "argv"), "utf-8");
      expect(argv.includes(kanarek), "heslo DB bylo v argv psql").toBe(false);
      expect(argv, "cíl spojení se nesmí změnit").toMatch(/postgresql:\/\/aisha_admin@db\.invalid:5432\/postgres/);
      expect(readFileSync(join(dir, "pgpassword"), "utf-8"), "psql musí heslo dostat prostředím").toBe(kanarek);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("třída: žádný volající ve scripts/ nepředá psql adresu v argv", () => {
  const soubory = execFileSync("git", ["ls-files", "scripts"], { cwd: ROOT, encoding: "utf-8" })
    .split("\n")
    .filter((f) => /\.(mjs|js|cjs|ts)$/.test(f));

  it("psql se spouští s cílem z psqlPripojeni, ne s adresou (univerzum ze stromu)", () => {
    const volani: string[] = [];
    const vady: string[] = [];
    // Každé spuštění psql z Node — array i shellová forma, i přes obal (inherit/capture…).
    const SPUSTENI = /\b[A-Za-z_$][\w$]*\(\s*(['"`])[^'"`]*\bpsql\b/g;
    // Pole argumentů začínající identifikátorem, který nese adresu.
    const ADRESA_V_POLI = /\b[A-Za-z_$][\w$]*\(\s*(['"`])psql\1\s*,\s*\[\s*([A-Za-z_$][\w$]*)/g;
    // Shellový řetězec s psql a dosazenou adresou.
    const ADRESA_V_RETEZCI = /\b(?:execSync|exec)\(\s*`[^`]*\bpsql\b[^`]*\$\{[^}]*(?:url|Url|URL|conn|Conn|dsn)[^}]*\}[^`]*`/g;
    for (const f of soubory) {
      if (f === "scripts/db/lib/psql-pripojeni.mjs") continue;
      const src = readFileSync(join(ROOT, f), "utf-8");
      for (const _ of src.matchAll(SPUSTENI)) volani.push(f);
      for (const m of src.matchAll(ADRESA_V_POLI)) {
        if (/url|conn|dsn/i.test(m[2])) vady.push(`${f}: psql dostává adresu v argv (${m[2]}) — použij psqlPripojeni()`);
      }
      for (const _ of src.matchAll(ADRESA_V_RETEZCI)) {
        vady.push(`${f}: psql v shellovém řetězci s dosazenou adresou — execFileSync + psqlPripojeni()`);
      }
    }
    // Prázdné univerzum = brána by prošla tím, že nic nenašla.
    expect(volani.length, "ve scripts/ se nenašlo žádné spuštění psql — detektor je slepý").toBeGreaterThan(5);
    for (const nutny of ["scripts/db/seed.mjs", "scripts/db/migrate.mjs", "scripts/db/provision-operators.mjs"]) {
      expect(volani, `${nutny} spouští psql v kontejneru migrate — musí být v univerzu`).toContain(nutny);
    }
    expect(vady).toEqual([]);
  });
});

describe("pojistka: entrypoint maskuje výstup dřív, než ho uloží do anon-čitelné tabulky", () => {
  const entry = readFileSync(join(ROOT, "scripts/docker-migrate-entrypoint.sh"), "utf-8");
  const zapis = entry.slice(entry.indexOf("write_dump() {"));
  const maska = zapis.match(/sed -E -i '([^']+)' "\$MIGRATE_OUT"/);

  it("maskuje se v write_dump PŘED prvním čtením výstupu", () => {
    expect(maska, "write_dump nemaskuje $MIGRATE_OUT").not.toBeNull();
    const kdeMaska = zapis.indexOf(maska![0]);
    const prvniCteni = zapis.search(/(?:tail|grep|sed -n)[^\n]*"\$MIGRATE_OUT"/);
    expect(prvniCteni).toBeGreaterThan(-1);
    expect(kdeMaska, "maska musí předejít prvnímu čtení $MIGRATE_OUT").toBeLessThan(prvniCteni);
  });

  it("výraz z entrypointu dá na vzorku totéž co bezHesla() a heslo nepropustí", () => {
    const vzorek = [
      "❌ Seed failed: Command failed: psql postgresql://aisha_admin:KANAREK%40x@db:5432/postgres -v ON_ERROR_STOP=1",
      "psql postgres://u:ab@cd@h/d -f x",
      "[migrate] npm run db:seed exit=1 · kontakt admin@example.test",
    ].join("\n");
    // Spouští se týž výraz, ne jeho kopie; bez -i, ať běží se sedem GNU, BSD i busybox.
    const r = spawnSync("sed", ["-E", maska![1]], { input: vzorek, encoding: "utf-8" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).not.toMatch(/KANAREK|ab@cd/);
    expect(r.stdout.trimEnd()).toBe(bezHesla(vzorek));
  });
});

describe("e-maily operátorů se do anon-čitelného migration_log_dump nedostanou (audit vydání 2026-10-01)", () => {
  const entry = readFileSync(join(ROOT, "scripts/docker-migrate-entrypoint.sh"), "utf-8");
  const zapis = entry.slice(entry.indexOf("write_dump() {"));
  const maskaEmailu = [...zapis.matchAll(/sed -E -i '([^']+)' "\$MIGRATE_OUT"/g)].find((m) => m[1].includes("@[A-Za-z0-9.-]+"));
  const cs = readFileSync(join(ROOT, "scripts/aisha-cold-start.sh"), "utf-8");

  it("write_dump maskuje e-maily PŘED prvním čtením výstupu", () => {
    expect(maskaEmailu, "write_dump nemaskuje e-maily v $MIGRATE_OUT").toBeDefined();
    const prvniCteni = zapis.search(/(?:tail|grep|sed -n)[^\n]*"\$MIGRATE_OUT"/);
    expect(zapis.indexOf(maskaEmailu![0])).toBeLessThan(prvniCteni);
  });

  it("výraz z entrypointu adresy zamaskuje, heslo v URL ani otisk nerozbije", () => {
    const otisk = "a".repeat(64);
    const vzorek = [
      "✓ Ops.Admin+x@Example.TEST → 1f0c…  roles=[admin]",
      "[migrate] PROVISION_GRANTED email=ops@firma.cz roles=admin",
      "psql postgresql://aisha_admin:***@db:5432/postgres",
      `[migrate] PROVISION_GRANTED email_sha256=${otisk} roles=admin,staff`,
    ].join("\n");
    const r = spawnSync("sed", ["-E", maskaEmailu![1]], { input: vzorek, encoding: "utf-8" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).not.toMatch(/Example\.TEST|firma\.cz/i);
    expect(r.stdout).toContain("aisha_admin:***@db:5432");
    expect(r.stdout).toContain(`email_sha256=${otisk}`);
  });

  it("řádek PROVISION_GRANTED nese otisk, ne adresu", () => {
    expect(entry).not.toMatch(/log "PROVISION_GRANTED email=/);
    expect(entry).toMatch(/log "PROVISION_GRANTED email_sha256=\$\{_gh\}/);
    expect(cs).not.toMatch(/PROVISION_GRANTED email=/);
  });

  it("entrypoint (sha256sum) i cold-start (openssl) dají TÝŽ otisk jako referenční sha256 z malých písmen", () => {
    const adresa = "Ops.Admin+x@Example.TEST";
    const ref = createHash("sha256").update(adresa.toLowerCase()).digest("hex");
    const vypocet = (prikaz: string) =>
      spawnSync("sh", ["-c", `printf '%s' "$A" | tr '[:upper:]' '[:lower:]' | ${prikaz} | cut -d' ' -f1`], {
        env: { ...process.env, A: adresa },
        encoding: "utf-8",
      }).stdout.trim();
    // Výpočty se čtou z KÓDU, ne opisují: kdyby se pipeline v jednom ze skriptů změnila, test to uvidí.
    expect(entry).toMatch(/tr '\[:upper:\]' '\[:lower:\]' \| sha256sum \| cut -d' ' -f1/);
    expect(cs).toMatch(/tr '\[:upper:\]' '\[:lower:\]' \| openssl dgst -sha256 -r \| cut -d' ' -f1/);
    expect(vypocet("openssl dgst -sha256 -r")).toBe(ref);
    const sha = spawnSync("sh", ["-c", "command -v sha256sum"], { encoding: "utf-8" });
    if (sha.status === 0) expect(vypocet("sha256sum")).toBe(ref);
  });

  it("heals vyčistí adresy i z už uložených řádků (obě tabulky, podmíněně)", () => {
    const sql = readFileSync(join(ROOT, "aisha/db/sql/grants/migration_log_dump_jen_cteni.sql"), "utf-8");
    expect(sql).toMatch(/UPDATE public\.migration_log_dump\s+SET output = regexp_replace\(output, '\[A-Za-z0-9\._%\+-\]\+@/);
    expect(sql).toMatch(/UPDATE aisha_meta\.migration_log\s+SET error_message = regexp_replace/);
    expect(sql).toMatch(/to_regclass\('aisha_meta\.migration_log'\) IS NOT NULL/);
  });
});
