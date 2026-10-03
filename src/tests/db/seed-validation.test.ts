/**
 * Seed SQL Validation Tests
 *
 * Mix of static file checks (always run) and live database checks
 * (auto-skip when no local PostgreSQL is reachable).
 *
 * The previous `supabase db reset` test was removed when the codebase
 * migrated off the Supabase CLI — drift detection happens through
 * the autonomous deploy flow (aisha-deploy-flow Phase 1), not here.
 *
 * Suppression: AISHA_SKIP_DB_TESTS=1 silences the DB-dependent checks
 * even if a local PostgreSQL is reachable.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  KOTVY_DOTAZNIKU_PLATFORMY,
  PROJEKTOVE_TABULKY,
  SOURCE_OF_TRUTH,
  getAbsolutePath,
  vypnuteTriggeryBezZapnuti,
} from "./validation-utils";
import {
  PG_HOST,
  PG_PORT,
  PG_USER,
  PG_PASSWORD,
  PG_DATABASE,
  isPgReachable,
} from "./test-env-probe";

const SEED_PATH = getAbsolutePath(SOURCE_OF_TRUTH.paths.seed);
const SEED_EXISTS = fs.existsSync(SEED_PATH);

const PROJEKTOVY_INSERT = new RegExp(
  `INSERT\\s+INTO\\s+(?:"?public"?\\.)?"?(${PROJEKTOVE_TABULKY.join("|")})"?[\\s(]`,
  "i",
);

/** Všechny zdrojové soubory seedu (všechny vrstvy, i ty, které se tu nekompilují). */
function seedSoubory(): { rel: string; sql: string }[] {
  const koren = getAbsolutePath(SOURCE_OF_TRUTH.paths.seedModules);
  const out: { rel: string; sql: string }[] = [];
  const projdi = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) projdi(p);
      else if (e.name.endsWith(".sql")) out.push({ rel: path.relative(koren, p), sql: fs.readFileSync(p, "utf-8") });
    }
  };
  projdi(koren);
  // Kontrolní vzorek: měřidlo musí něco vidět, jinak by zezelenalo naprázdno.
  if (out.length < 20) throw new Error(`seedSoubory: nalezeno jen ${out.length} souborů v ${koren} — měřidlo nic neměří`);
  return out;
}

describe("Seed SQL — Static File Validation", () => {
  it("seed.compiled.sql exists at canonical path", () => {
    expect(SEED_EXISTS).toBe(true);
  });

  it.skipIf(!SEED_EXISTS)("seed.compiled.sql is not empty", () => {
    const content = fs.readFileSync(SEED_PATH, "utf-8");
    expect(content.length).toBeGreaterThan(1000);
  });

  it.skipIf(!SEED_EXISTS)("seed.compiled.sql contains INSERT statements", () => {
    const content = fs.readFileSync(SEED_PATH, "utf-8");
    const insertCount = (content.match(/INSERT INTO/gi) || []).length;
    expect(insertCount).toBeGreaterThan(10);
  });

  it.skipIf(!SEED_EXISTS)("seed.compiled.sql references required platform tables", () => {
    const content = fs.readFileSync(SEED_PATH, "utf-8");
    for (const table of ["aisha_auth.users", ...SOURCE_OF_TRUTH.seedRequiredInsertTables.map((t) => `public.${t}`)]) {
      expect(content, `Missing reference to ${table}`).toContain(table);
    }
  });

  // ⛔ Rozhodnutí majitele 2026-09-24: v centrálním repu žádná projektová data.
  // Měří se ZDROJE všech vrstev (ne jen zkompilovaný demo profil), aby je
  // nevrátil ani profil, který se tu nekompiluje.
  it("no seed layer inserts into project-data tables", () => {
    const nalezy = seedSoubory()
      .map((f) => [f.rel, f.sql.replace(/--.*$/gm, "").match(PROJEKTOVY_INSERT)?.[1]] as const)
      .filter(([, t]) => t)
      .map(([f, t]) => `${f} → ${t}`);
    expect(nalezy, "projektová data patří do vrstvy instance, ne do platformy").toEqual([]);
  });

  it("questionnaires: seed inserts only the platform anchor rows", () => {
    const vlozene = seedSoubory().flatMap((f) =>
      [...f.sql.replace(/--.*$/gm, "").matchAll(/INSERT\s+INTO\s+(?:public\.)?questionnaires\b[\s\S]*?;/gi)].flatMap((m) =>
        [...m[0].matchAll(/\(\s*'([0-9a-f-]{36})'/gi)].map((u) => `${f.rel} → ${u[1]}`),
      ),
    );
    // Kontrolní vzorek: kotvy samy musí být vidět, jinak měřidlo nic neměří.
    expect(vlozene.length).toBeGreaterThanOrEqual(KOTVY_DOTAZNIKU_PLATFORMY.length);
    const cizi = vlozene.filter((v) => !KOTVY_DOTAZNIKU_PLATFORMY.some((k) => v.endsWith(k)));
    expect(cizi, "dotazníky s obsahem patří do vrstvy instance").toEqual([]);
  });

  // Pár vypni/zapni musí ležet v JEDNOM souboru — profil, který soubor se
  // zapnutím vynechá, jinak nechá trigger vypnutý (naměřeno na produkci).
  it("every seed file re-enables the triggers it disables", () => {
    const nalezy = seedSoubory().flatMap((f) => vypnuteTriggeryBezZapnuti(f.sql).map((t) => `${f.rel} → ${t}`));
    expect(nalezy).toEqual([]);
  });
});

// =============================================================================
// Live DB checks — only when PostgreSQL is reachable
// =============================================================================

const canRunLiveTests = SEED_EXISTS && isPgReachable();

describe.skipIf(!canRunLiveTests)("Seed SQL — Live Syntax Validation", () => {
  it("seed.compiled.sql parses without fatal SQL errors", () => {
    // Run psql with ON_ERROR_STOP=1 in a rolled-back transaction to validate
    // syntax without leaving permanent state. "already exists" warnings are
    // expected (re-runs on a seeded DB) and are filtered out.
    const result = execFileSync(
      "psql",
      [
        "-h",
        PG_HOST,
        "-p",
        PG_PORT,
        "-U",
        PG_USER,
        "-d",
        PG_DATABASE,
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        "BEGIN;",
        "-f",
        SEED_PATH,
        "-c",
        "ROLLBACK;",
      ],
      {
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, PGPASSWORD: PG_PASSWORD },
      },
    );

    const errorLines = (result.match(/^ERROR:.*$/gm) || []).filter(
      (line) => !line.includes("already exists"),
    );

    expect(errorLines, `Seed SQL errors:\n${errorLines.join("\n")}`).toHaveLength(0);
  });
});

describe.skipIf(!canRunLiveTests)("Seed SQL — Live Data Count Validation", () => {
  it("seeded database has expected minimum row counts", () => {
    const result = execFileSync(
      "psql",
      [
        "-h",
        PG_HOST,
        "-p",
        PG_PORT,
        "-U",
        PG_USER,
        "-d",
        PG_DATABASE,
        "-t",
        "-A",
        "-F",
        ",",
        "-c",
        `SELECT
           (SELECT COUNT(*) FROM auth.users) AS users,
           (SELECT COUNT(*) FROM public.profiles) AS profiles,
           (SELECT COUNT(*) FROM public.user_roles) AS user_roles;`,
      ],
      {
        encoding: "utf-8",
        env: { ...process.env, PGPASSWORD: PG_PASSWORD },
      },
    );

    const [users, profiles, userRoles] = result
      .trim()
      .split(",")
      .map(Number);

    // Platforma sama: seed-admin a jeho role. Projektové tabulky hlídá
    // schema-validation-v2 (EXACT 0 z PROJEKTOVE_TABULKY).
    expect(users).toBeGreaterThanOrEqual(1);
    expect(profiles).toBeGreaterThanOrEqual(1);
    expect(userRoles).toBeGreaterThanOrEqual(1);
  });
});
