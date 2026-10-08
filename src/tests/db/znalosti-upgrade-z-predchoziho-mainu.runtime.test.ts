/**
 * Seed HEAD na DB naseedované PŘEDCHOZÍM mainem — brána datového upgradu.
 *
 * ⛔ PROČ (výpadek 2026-09-24): CI měřila seed jen nad čistou DB. Přečíslovaná id seedu
 * prošla zeleně a nasazení na existující DB spadlo na duplicitním přirozeném klíči; Core
 * stál přes 12 h. Existující brána upgradu (scripts/db/verify-upgrade-apply.sh) regresuje
 * SCHÉMA, ne DATA předchozího seedu. Tahle zkouška dělá přesně to, co nasazení na
 * existující instanci:
 *   1. DB postavená z baseline PŘEDCHOZÍHO mainu (jeho migrate.mjs) a naseedovaná JEHO seedem,
 *   2. migrate.mjs HEAD nad ní (existující DB → heals.sql),
 *   3. seed HEAD dvakrát (seed běží při každém nasazení).
 * Pak měří: položky znalostí ze zkušenosti jsou právě jednou a stabilní, ve vyhrazeném
 * prostoru ani mimo něj není duplicitní slug, samotný soubor seedu znalostí nepřidá řádek
 * a nepřihlášený je najde v globální KB.
 *
 * „Předchozí main“: AISHA_PREDCHOZI_MAIN, jinak merge-base(HEAD, origin/main); běží-li se
 * přímo na mainu (merge-base = HEAD), první rodič HEAD. Bez historie gitu (mělký checkout)
 * je výsledek NEZMĚŘENO a test spadne — nikdy tichá zelená.
 *
 * Probe DB vzniká vedle testovací DB na témže clusteru a po testu zmizí.
 * Běh: AISHA_TESTDB_POVINNA=1 npm run test:db:znalosti
 */
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PLATFORM_OUTPUT_FILE, buildSeedSql } from "../../../scripts/db/gen-knowledge-seed.mjs";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";
import { PG_DATABASE, PG_HOST, PG_PASSWORD, PG_PORT, PG_USER, isPgReachable } from "./test-env-probe";

const ROOT = resolve(__dirname, "../../..");
const PROBE = `znalosti_upgrade_${randomUUID().slice(0, 8)}`;
const ENV = { ...process.env, PGPASSWORD: PG_PASSWORD };
const PROBE_URL = `postgresql://${PG_USER}:${encodeURIComponent(PG_PASSWORD)}@${PG_HOST}:${PG_PORT}/${PROBE}`;
const zaklad = (db: string) => ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", db, "-v", "ON_ERROR_STOP=1"];
const sql = (db: string, dotaz: string) =>
  execFileSync("psql", [...zaklad(db), "-tA", "-c", dotaz], { encoding: "utf-8", env: ENV }).trim();
const soubor = (db: string, cesta: string) => {
  const r = spawnSync("psql", [...zaklad(db), "-q", "-f", cesta], { encoding: "utf-8", env: ENV, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`psql -f ${cesta} → ${r.status}: ${(r.stderr ?? "").split("\n").slice(-8).join("\n")}`);
};
const git = (...a: string[]) => execFileSync("git", a, { cwd: ROOT, encoding: "utf-8" }).trim();
const execFileP = promisify(execFile);
const souborAsync = async (db: string, cesta: string) => {
  try {
    await execFileP("psql", [...zaklad(db), "-q", "-f", cesta], { env: ENV, maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    const chyba = (e as { stderr?: string }).stderr ?? String(e);
    throw new Error(`psql -f ${cesta}: ${chyba.split("\n").slice(-8).join("\n")}`);
  }
};

/** Předchozí main, nebo důvod, proč ho nejde určit (pak NEZMĚŘENO). */
function predchoziMain(): { ref?: string; duvod?: string } {
  if (process.env.AISHA_PREDCHOZI_MAIN) return { ref: process.env.AISHA_PREDCHOZI_MAIN };
  try {
    const hlava = git("rev-parse", "HEAD");
    const baze = git("merge-base", "HEAD", "origin/main");
    return { ref: baze === hlava ? git("rev-parse", "HEAD^1") : baze };
  } catch (e) {
    return { duvod: `předchozí main nejde určit z gitu (mělký checkout? chybí origin/main?): ${e instanceof Error ? e.message.split("\n")[0] : e}` };
  }
}

type Polozka = { slug: string };
const { zarazene } = buildSeedSql() as { zarazene: Polozka[] };
const seznam = zarazene.map((p) => `'${p.slug}'`).join(", ");
const nase = () =>
  sql(PROBE, `SELECT count(*) || '|' || coalesce(string_agg(id || ':' || version || ':' || md5(body_markdown), ',' ORDER BY id), '')
                FROM public.knowledge_items WHERE source_type = 'platform_knowledge' AND source_slug IN (${seznam})`);

describe.skipIf(!isPgReachable())("seed HEAD na DB naseedované předchozím mainem", () => {
  const predchozi = predchoziMain();
  const stav: { predPocet?: number; poPrvnim?: string; poDruhem?: string } = {};

  // ⛔ ASYNCHRONNĚ: stavba dvou schémat a tři seedy trvají přes minutu. Synchronní blok
  // (execFileSync) by smyčku událostí workeru neotočil a vitest by skončil „Timeout calling
  // onTaskUpdate“ s rc 1, ačkoli všechna tvrzení prošla (naměřeno 2026-10-05 na téhle sadě).
  beforeAll(async () => {
    if (!predchozi.ref) return;
    const strom = mkdtempSync(join(tmpdir(), "predchozi-main-"));
    const tar = join(strom, "strom.tar");
    const archiv = await execFileP("git", ["archive", "--format=tar", predchozi.ref, "aisha/db", "scripts/db", "infra/postgres"], {
      cwd: ROOT,
      encoding: "buffer",
      maxBuffer: 512 * 1024 * 1024,
    });
    writeFileSync(tar, archiv.stdout);
    await execFileP("tar", ["-xf", tar, "-C", strom]);

    await execFileP("psql", [...zaklad(PG_DATABASE), "-tA", "-c", `CREATE DATABASE ${PROBE}`], { env: ENV });
    await souborAsync(PROBE, join(strom, "infra/postgres/000_init_roles_schemas.sql"));
    // 1. schéma a data PŘEDCHOZÍHO mainu — jeho vlastní nástroj nad jeho baseline
    await execFileP("node", [join(strom, "scripts/db/migrate.mjs")], {
      cwd: strom,
      // strom je rozbalený archiv mimo repo — zděděná git lokace volajícího by v něm mířila jinam
      env: { ...envWithoutGitLocation(ENV), AISHA_DB_URL: PROBE_URL },
      maxBuffer: 64 * 1024 * 1024,
    });
    await souborAsync(PROBE, join(strom, "aisha/db/seed.compiled.sql"));
    stav.predPocet = Number(sql(PROBE, `SELECT count(*) FROM public.knowledge_items`));
    // 2. migrate HEAD nad existující DB (cesta nasazení: heals.sql)
    await execFileP("node", [join(ROOT, "scripts/db/migrate.mjs")], {
      cwd: ROOT,
      env: { ...ENV, AISHA_DB_URL: PROBE_URL },
      maxBuffer: 64 * 1024 * 1024,
    });
    // 3. seed HEAD dvakrát
    await souborAsync(PROBE, join(ROOT, "aisha/db/seed.compiled.sql"));
    stav.poPrvnim = nase();
    await souborAsync(PROBE, join(ROOT, "aisha/db/seed.compiled.sql"));
    stav.poDruhem = nase();
  }, 900_000);

  afterAll(() => {
    if (predchozi.ref) sql(PG_DATABASE, `DROP DATABASE IF EXISTS ${PROBE} WITH (FORCE)`);
  });
  // Jedna makroúloha mezi případy: worker stihne potvrdit průběh (limit RPC 60 s).
  afterEach(() => new Promise((r) => setImmediate(r)));

  it("předchozí main je určený — bez něj NEZMĚŘENO, ne zelená", () => {
    expect(predchozi.duvod ?? "", "NEZMĚŘENO").toBe("");
    expect(predchozi.ref).toMatch(/^[0-9a-f]{7,40}$|^[\w./-]+$/);
  });

  it("kotva: DB předchozího mainu nese data jeho seedu", () => {
    expect(stav.predPocet ?? 0).toBeGreaterThan(0);
  });

  it("položky znalostí ze zkušenosti jsou po upgradu právě jednou a druhý seed je nezmění", () => {
    expect(stav.poPrvnim?.split("|")[0]).toBe(String(zarazene.length));
    expect(stav.poDruhem).toBe(stav.poPrvnim);
  });

  it("žádný duplicitní slug — ve vyhrazeném prostoru ani mimo něj", () => {
    expect(
      sql(PROBE, `SELECT count(*) FROM (SELECT source_slug, locale FROM public.knowledge_items
                   WHERE source_slug IS NOT NULL AND source_type IN ('platform_knowledge', 'instance_knowledge')
                   GROUP BY 1, 2 HAVING count(*) > 1) d`),
    ).toBe("0");
    expect(
      sql(PROBE, `SELECT count(*) FROM (SELECT source_slug, locale FROM public.knowledge_items
                   WHERE source_slug IS NOT NULL AND source_type NOT IN ('platform_knowledge', 'instance_knowledge')
                   GROUP BY 1, 2 HAVING count(*) > 1) d`),
    ).toBe("0");
  });

  it("samotný soubor seedu znalostí nad upgradovanou DB nepřidá žádný řádek", () => {
    const pred = sql(PROBE, `SELECT count(*) FROM public.knowledge_items`);
    soubor(PROBE, PLATFORM_OUTPUT_FILE);
    expect(sql(PROBE, `SELECT count(*) FROM public.knowledge_items`)).toBe(pred);
    expect(nase()).toBe(stav.poDruhem);
  });

  it("P2: upgradovaná DB hledá podle identity vah — podpis v3 beze změny, nové tělo, pomocníci zapojení přes heals", () => {
    const v3 = (sig: string) => `to_regprocedure('public.mcp_search_knowledge_v3(vector,halfvec,text,text[],text,text,text[],boolean,integer,numeric,uuid,text,text,text,uuid${sig})')`;
    // Identitu volající nezadává (revize 2026-10-07) — žádný 16argumentový podpis vedle.
    expect(sql(PROBE, `SELECT (${v3("")} IS NOT NULL) || '|' || (${v3(",text")} IS NULL)`)).toBe("true|true");
    expect(sql(PROBE, `SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                         AND proname IN ('fn_deklarace_vah_embeddingu', 'fn_identita_vektoru')`)).toBe("2");
    // Těla na existující DB jsou ta NOVÁ (heals je přehrál), ne jen podpis.
    expect(sql(PROBE, `SELECT position('fn_identita_vektoru(ke.model_version) = v_identita' IN prosrc) > 0
                         FROM pg_proc WHERE oid = ${v3("")}`)).toBe("t");
    expect(sql(PROBE, `SELECT position('fn_deklarace_vah_embeddingu' IN prosrc) > 0 FROM pg_proc
                         WHERE oid = 'public.fn_ziva_identita_v1()'::regprocedure`)).toBe("t");
    expect(sql(PROBE, `SELECT position('fn_identita_vektoru(e.model_version)' IN prosrc) > 0 FROM pg_proc
                         WHERE oid = 'public.fn_chunks_bez_zive_identity(text,text,integer,integer)'::regprocedure`)).toBe("t");
    expect(sql(PROBE, `SELECT has_function_privilege('authenticated', 'public.fn_deklarace_vah_embeddingu(text)', 'EXECUTE')`)).toBe("f");
  });

  it("nepřihlášený je v upgradované DB najde v globální KB", () => {
    const nalezene = sql(
      PROBE,
      `SELECT set_config('request.jwt.claims', '{"role":"anon"}', false); SET ROLE anon;
       SELECT count(*) FROM jsonb_array_elements(public.mcp_search_knowledge_v2(
         p_context_tags => ARRAY['knowledge-from-experience'], p_limit => 200,
         p_story_id => NULL::uuid, p_audience_user_id => NULL::uuid)) r
       WHERE r->>'source_slug' IN (${seznam});`,
    )
      .split("\n")
      .pop();
    expect(nalezene).toBe(String(zarazene.length));
  });
});
