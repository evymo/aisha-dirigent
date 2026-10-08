/**
 * Upgrade na datech PŘEDCHOZÍHO mainu bez duplicit seedu.
 *
 * Přesně cesta nasazení na existující instanci:
 *   1. DB z baseline předchozího mainu (jeho migrate.mjs), naseedovaná JEHO seedem 2×
 *      (seed běží při každém nasazení — instance jich má za sebou mnoho),
 *   2. migrate.mjs HEAD nad ní (existující DB → heals.sql, včetně bloku seed-bez-duplicit),
 *   3. seed HEAD 2×.
 * Měří: po upgradu žádná dvojice znalostí se stejným obsahem a zařazením, žádný zdvojený
 * vzor hodnocení, zrcadlo expert_rules právě jedno na pravidlo, a druhý seed HEAD
 * nepřidá v žádném zdroji ani řádek.
 *
 * ⛔ Výpadek 2026-09-24: seed se měřil jen nad čistou DB. Tahle zkouška je datová
 * obdoba scripts/db/verify-upgrade-apply.sh (ten regresuje SCHÉMA, ne data seedu).
 * Harness je tentýž jako v bráně upgradu znalostí (znalosti-upgrade-z-predchoziho-mainu,
 * větev feat/znalosti-platformy) — při sloučení se obě zkoušky spojí nad jednou probe DB.
 *
 * „Předchozí main“: AISHA_PREDCHOZI_MAIN, jinak merge-base(HEAD, origin/main); běží-li se
 * přímo na mainu (merge-base = HEAD), první rodič HEAD. Bez historie gitu (mělký checkout)
 * je výsledek NEZMĚŘENO a test spadne — nikdy tichá zelená.
 *
 * Běh: AISHA_TESTDB_POVINNA=1 npm run test:db:seed-bez-duplicit
 */
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";
import { isPgReachable } from "./test-env-probe";
import {
  ENV,
  ROOT,
  SEED_HEAD,
  duplicityVzoru,
  duplicityZnalosti,
  migrate,
  soubor,
  zalozProbe,
  zdrojeZnalosti,
  zrcadla,
  zrusProbe,
} from "./seed-duplicity";

const spust = promisify(execFile);
const PROBE = `seed_upgrade_${randomUUID().slice(0, 8)}`;

async function git(...a: string[]): Promise<string> {
  const { stdout } = await spust("git", a, { cwd: ROOT, maxBuffer: 512 * 1024 * 1024 });
  return stdout.trim();
}

/** Předchozí main, nebo důvod, proč ho nejde určit (pak NEZMĚŘENO). */
async function predchoziMain(): Promise<{ ref?: string; duvod?: string }> {
  if (process.env.AISHA_PREDCHOZI_MAIN) return { ref: process.env.AISHA_PREDCHOZI_MAIN };
  try {
    const hlava = await git("rev-parse", "HEAD");
    const baze = await git("merge-base", "HEAD", "origin/main");
    return { ref: baze === hlava ? await git("rev-parse", "HEAD^1") : baze };
  } catch (e) {
    return {
      duvod: `předchozí main nejde určit z gitu (mělký checkout? chybí origin/main?): ${e instanceof Error ? e.message.split("\n")[0] : e}`,
    };
  }
}

type Stav = { dupl: string[]; duplVzoru: string[]; zdroje: Record<string, number>; zrcadla: Awaited<ReturnType<typeof zrcadla>> };
const zmer = async (): Promise<Stav> => ({
  dupl: await duplicityZnalosti(PROBE),
  duplVzoru: await duplicityVzoru(PROBE),
  zdroje: await zdrojeZnalosti(PROBE),
  zrcadla: await zrcadla(PROBE),
});

describe.skipIf(!isPgReachable())("seed HEAD na DB naseedované předchozím mainem — bez duplicit", () => {
  let predchozi: { ref?: string; duvod?: string } = {};
  const stav: { predchozi?: Stav; poPrvnim?: Stav; poDruhem?: Stav } = {};

  beforeAll(async () => {
    predchozi = await predchoziMain();
    if (!predchozi.ref) return;
    const strom = mkdtempSync(join(tmpdir(), "predchozi-main-"));
    const tar = join(strom, "strom.tar");
    await spust("git", ["archive", "--format=tar", "-o", tar, predchozi.ref, "aisha/db", "scripts/db", "scripts/lib", "infra/postgres"], {
      cwd: ROOT,
      maxBuffer: 512 * 1024 * 1024,
    });
    await spust("tar", ["-xf", tar, "-C", strom]);

    // 1. schéma a data PŘEDCHOZÍHO mainu — jeho vlastní nástroj nad jeho baseline, jeho seed 2×
    await zalozProbe(PROBE, strom);
    // strom je rozbalený archiv mimo repo — zděděná git lokace volajícího by v něm mířila jinam
    await migrate(PROBE, strom, envWithoutGitLocation(ENV));
    await soubor(PROBE, join(strom, "aisha/db/seed.compiled.sql"));
    await soubor(PROBE, join(strom, "aisha/db/seed.compiled.sql"));
    stav.predchozi = await zmer();
    // 2. migrate HEAD nad existující DB (cesta nasazení: heals.sql)
    await migrate(PROBE);
    // 3. seed HEAD dvakrát
    await soubor(PROBE, SEED_HEAD);
    stav.poPrvnim = await zmer();
    await soubor(PROBE, SEED_HEAD);
    stav.poDruhem = await zmer();
  }, 1_200_000);

  afterAll(async () => {
    if (predchozi.ref) await zrusProbe(PROBE);
  }, 120_000);

  afterEach(() => new Promise<void>((r) => setImmediate(r)));

  it("předchozí main je určený — bez něj NEZMĚŘENO, ne zelená", () => {
    expect(predchozi.duvod ?? "", "NEZMĚŘENO").toBe("");
    expect(predchozi.ref).toMatch(/^[0-9a-f]{7,40}$|^[\w./-]+$/);
  });

  it("kotva: DB předchozího mainu nese data jeho seedu (znalosti i pravidla)", () => {
    const znalosti = Object.values(stav.predchozi?.zdroje ?? {}).reduce((a, b) => a + b, 0);
    expect(znalosti).toBeGreaterThan(0);
    expect(stav.predchozi?.zrcadla.pravidla ?? 0).toBeGreaterThan(0);
  });

  it("po migrate HEAD a seedu HEAD žádná duplicita znalostí ani vzorů", () => {
    expect(stav.poPrvnim?.dupl).toEqual([]);
    expect(stav.poPrvnim?.duplVzoru).toEqual([]);
    expect(stav.poDruhem?.dupl).toEqual([]);
    expect(stav.poDruhem?.duplVzoru).toEqual([]);
  });

  it("zrcadlo expert_rules je po upgradu právě jedno na pravidlo", () => {
    for (const s of [stav.poPrvnim, stav.poDruhem]) {
      expect(s?.zrcadla.viceNezJedno).toBe(0);
      expect(s?.zrcadla.bezZrcadla).toBe(0);
      expect(s?.zrcadla.zrcadla).toBe(s?.zrcadla.pravidla);
    }
  });

  it("druhý seed HEAD nepřidá v žádném zdroji znalostí ani řádek", () => {
    expect(stav.poDruhem?.zdroje).toEqual(stav.poPrvnim?.zdroje);
  });
});
