/**
 * Oprava pohledů s právy vlastníka a edge_* dispečerů na DATECH PŘEDCHOZÍHO MAINU.
 *
 * ⛔ PROČ: bezpečnostní oprava, která dosedne jen na čistou DB, není oprava. Baseline
 * se na běžící DB nikdy nepřehraje; jediná cesta je heals.sql — a REVOKE na běžící
 * DB musí sebrat i granty, které tam nechaly dřívější bloky heals a ALTER DEFAULT
 * PRIVILEGES (čerstvá DB je vůbec nemá). Tahle zkouška dělá přesně to, co nasazení
 * na existující instanci:
 *   1. DB postavená PŘEDCHOZÍM mainem (jeho migrate.mjs + seed) a v ní živá data:
 *      dva vlastníci se stavovými check-iny, objednávka čekající na převod, předplatné;
 *   2. kotva: na té DB anon OPRAVDU čte souhrny obou vlastníků (jinak by „po" měřilo
 *      díru, která tam nebyla);
 *   3. migrate.mjs HEAD nad ní (cesta heals) — dvakrát, heals běží při každém nasazení;
 *   4. měří: anon nic, člen nepárovává platbu, katalog bez klientských grantů na
 *      pohledech s právy vlastníka, data beze ztráty, služba vidí oba vlastníky.
 *
 * „Předchozí main": AISHA_PREDCHOZI_MAIN, jinak merge-base(HEAD, origin/main); běží-li
 * se přímo na mainu, první rodič HEAD. Bez historie gitu → NEZMĚŘENO a pád, nikdy
 * tichá zelená. Probe DB vzniká vedle testovací DB na témže clusteru a po testu zmizí.
 *
 * Běh: AISHA_TESTDB_POVINNA=1 npm run test:db:pohledy-edge
 */
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";
import { PG_DATABASE, PG_HOST, PG_PASSWORD, PG_PORT, PG_USER, isPgReachable } from "./test-env-probe";

const ROOT = resolve(__dirname, "../../..");
const PROBE = `pohledy_upgrade_${randomUUID().slice(0, 8)}`;
const ENV = { ...process.env, PGPASSWORD: PG_PASSWORD };
const PROBE_URL = `postgresql://${PG_USER}:${encodeURIComponent(PG_PASSWORD)}@${PG_HOST}:${PG_PORT}/${PROBE}`;
const zaklad = (db: string) => ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", db, "-X", "-v", "ON_ERROR_STOP=1"];
const sql = (db: string, dotaz: string) =>
  execFileSync("psql", [...zaklad(db), "-qtA"], { input: dotaz, encoding: "utf-8", env: ENV }).trim();
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

type Kdo = { role: "anon" } | { role: "service_role" } | { role: "authenticated"; sub: string };
const claims = (k: Kdo) => JSON.stringify(k.role === "authenticated" ? { role: k.role, sub: k.sub } : { role: k.role });
/** Dotaz v probe DB jako daná identita (DB role + claims); chyba DB = text chyby. */
function jako(k: Kdo, dotaz: string): string {
  const r = spawnSync("psql", [...zaklad(PROBE), "-qtA"], {
    input: `\\o /dev/null\nBEGIN;\nSET LOCAL ROLE ${k.role};\nSELECT set_config('request.jwt.claims', '${claims(k)}', true);\n\\o\n${dotaz};\n\\o /dev/null\nROLLBACK;\n`,
    encoding: "utf-8",
    env: ENV,
  });
  return r.status === 0 ? r.stdout.trim() : `CHYBA: ${(r.stderr.match(/ERROR:\s+([^\n]+)/) ?? [])[1] ?? r.stderr}`;
}

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

const ALICE = randomUUID();
const BOB = randomUUID();
const OBJEDNAVKA = randomUUID();
const BALICEK = randomUUID();
const PREDPLATNE = randomUUID();
const RUN = ALICE.slice(0, 8);
const POHLEDY_STAVU = ["v_health_weekly_summary", "v_health_monthly_summary"];
const SLUZBA_JEN = ["study_cohort_statistics", "study_cohort_trends", "distribution_adjustments_overview", "shipment_statistics"];
const oba = [ALICE, BOB].sort().join(",");
const viditelni = (k: Kdo, relace: string) =>
  jako(k, `SELECT coalesce(string_agg(DISTINCT user_id::text, ',' ORDER BY user_id::text), '')
             FROM public.${relace} WHERE user_id IN ('${ALICE}', '${BOB}')`);
const otisk = () =>
  sql(PROBE, `SELECT (SELECT count(*) FROM public.health_check_ins WHERE user_id IN ('${ALICE}', '${BOB}'))
               || '|' || (SELECT payment_status || '/' || status FROM public.orders WHERE id = '${OBJEDNAVKA}')
               || '|' || (SELECT status FROM public.member_subscriptions WHERE id = '${PREDPLATNE}')`);
/** Pohledy s právy vlastníka, které čte klient — mimo vědomě veřejné projekce. */
const klientskeGranty = () => {
  const verejne = (JSON.parse(readFileSync(join(ROOT, "src/tests/gates/pohledy-verejne-pro-cteni.json"), "utf8")) as {
    verejne: Record<string, { role: string[] }>;
  }).verejne;
  const radky = sql(PROBE, `
    SELECT c.relname || '|' || concat_ws(',',
             CASE WHEN has_table_privilege('anon', c.oid, 'SELECT') THEN 'anon' END,
             CASE WHEN has_table_privilege('authenticated', c.oid, 'SELECT') THEN 'authenticated' END,
             CASE WHEN has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE') THEN 'authenticated:DML' END)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
       AND coalesce((SELECT option_value FROM pg_options_to_table(c.reloptions) WHERE option_name = 'security_invoker'), 'false') <> 'true'
     ORDER BY 1`);
  return radky
    .split("\n")
    .filter(Boolean)
    .flatMap((r) => {
      const [jmeno, prava = ""] = r.split("|");
      return prava.split(",").filter((p) => p && !(verejne[jmeno]?.role ?? []).includes(p)).map((p) => `${jmeno} (${p})`);
    });
};

describe.skipIf(!isPgReachable())("pohledy + edge_* dispečery: upgrade na datech předchozího mainu", () => {
  const predchozi = predchoziMain();
  const stav: { predOtisk?: string; anonPred?: Record<string, string>; poOtisk?: string; poDruhem?: string; granty?: string[] } = {};

  // ⛔ ASYNCHRONNĚ: stavba schématu předchozího mainu a dva průchody heals trvají minuty.
  // Synchronní blok by smyčku událostí workeru neotočil („Timeout calling onTaskUpdate").
  beforeAll(async () => {
    if (!predchozi.ref) return;
    const strom = mkdtempSync(join(tmpdir(), "predchozi-main-pohledy-"));
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
    // 1. schéma a seed PŘEDCHOZÍHO mainu — jeho vlastní nástroj nad jeho baseline
    await execFileP("node", [join(strom, "scripts/db/migrate.mjs")], {
      cwd: strom,
      env: { ...envWithoutGitLocation(ENV), AISHA_DB_URL: PROBE_URL },
      maxBuffer: 64 * 1024 * 1024,
    });
    await souborAsync(PROBE, join(strom, "aisha/db/seed.compiled.sql"));
    // …a živá data, jak je za předchozího mainu zapsaly klienti (check-in s přihlášeným
    // vlastníkem — trigger streaku chce auth.uid()).
    sql(PROBE, `SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
      INSERT INTO aisha_auth.users (id, email) VALUES ('${ALICE}', 'upg-alice-${RUN}@test.local'), ('${BOB}', 'upg-bob-${RUN}@test.local');
      INSERT INTO public.user_roles (user_id, role) VALUES ('${ALICE}', 'member'), ('${BOB}', 'member') ON CONFLICT DO NOTHING;
      INSERT INTO public.orders (id, user_id, total, status, payment_status, variable_symbol)
        VALUES ('${OBJEDNAVKA}', '${ALICE}', 990, 'pending', 'awaiting_transfer', '7${RUN.replace(/\D/g, "1").slice(0, 7)}');
      INSERT INTO public.subscription_packages (id, name, slug, is_active) VALUES ('${BALICEK}', 'Upg ${RUN}', 'upg-${RUN}', true);
      INSERT INTO public.member_subscriptions (id, user_id, package_id, status) VALUES ('${PREDPLATNE}', '${ALICE}', '${BALICEK}', 'pending_payment');`);
    for (const kdo of [ALICE, BOB]) {
      sql(PROBE, `SELECT set_config('request.jwt.claims', '{"role":"service_role","sub":"${kdo}"}', false);
        INSERT INTO public.health_check_ins (user_id, pain_level, mood_level, heart_rate_avg) VALUES ('${kdo}', 5, 5, 70);`);
    }
    stav.predOtisk = otisk();
    stav.anonPred = Object.fromEntries(POHLEDY_STAVU.map((p) => [p, viditelni({ role: "anon" }, p)]));

    // 2. migrate HEAD nad existující DB (cesta nasazení: heals.sql) — dvakrát
    for (const pruchod of ["poOtisk", "poDruhem"] as const) {
      await execFileP("node", [join(ROOT, "scripts/db/migrate.mjs")], {
        cwd: ROOT,
        env: { ...ENV, AISHA_DB_URL: PROBE_URL },
        maxBuffer: 64 * 1024 * 1024,
      });
      stav[pruchod] = otisk();
    }
    stav.granty = klientskeGranty();
  }, 1_200_000);

  afterAll(() => {
    if (predchozi.ref) sql(PG_DATABASE, `DROP DATABASE IF EXISTS ${PROBE} WITH (FORCE)`);
  });
  // Jedna makroúloha mezi případy: worker stihne potvrdit průběh (limit RPC 60 s).
  afterEach(() => new Promise((r) => setImmediate(r)));

  it("předchozí main je určený — bez něj NEZMĚŘENO, ne zelená", () => {
    expect(predchozi.duvod ?? "", "NEZMĚŘENO").toBe("");
    expect(predchozi.ref).toMatch(/^[0-9a-f]{7,40}$|^[\w./-]+$/);
  });

  it("kotva: na DB předchozího mainu nesou data oba vlastníci a anon je OPRAVDU četl", () => {
    expect(stav.predOtisk).toBe("2|awaiting_transfer/pending|pending_payment");
    // Kotva díry: bez ní by „anon po upgradu nic nečte" mohlo jen znamenat, že sonda
    // měří nad prázdnem. Jakmile předchozí main díru nemá (po sloučení této větve),
    // kotva se obrátí — pak ji smaž spolu s tímto komentářem, test „po" platí dál.
    for (const p of POHLEDY_STAVU) expect(stav.anonPred?.[p], `${p}: anon před upgradem`).toBe(oba);
  });

  it("⛔ po upgradu anon souhrny stavu nečte a člen nečte pohledy jen pro službu", () => {
    for (const p of POHLEDY_STAVU) {
      expect(viditelni({ role: "anon" }, p), p).toMatch(/permission denied for view/);
    }
    for (const p of SLUZBA_JEN) {
      expect(jako({ role: "anon" }, `SELECT count(*) FROM public.${p}`), p).toMatch(/permission denied for view/);
      expect(jako({ role: "authenticated", sub: ALICE }, `SELECT count(*) FROM public.${p}`), p).toMatch(/permission denied for view/);
    }
  });

  it("⛔ po upgradu katalog nemá klientský grant na žádný pohled s právy vlastníka (mimo veřejné)", () => {
    expect(stav.granty, "granty z dřívějška nebo z default privileges přežily heals").toEqual([]);
  });

  it("⛔ po upgradu člen nezaplatí vlastní objednávku ani neaktivuje předplatné", () => {
    expect(jako({ role: "authenticated", sub: ALICE },
      `SELECT public.edge_bank_transactions('match_to_order', '{"order_id":"${OBJEDNAVKA}","transaction_id":"${OBJEDNAVKA}"}'::jsonb)`))
      .toMatch(/Access denied/);
    expect(jako({ role: "authenticated", sub: ALICE },
      `SELECT public.edge_subscriptions('update_subscription', '{"id":"${PREDPLATNE}","status":"active"}'::jsonb)`))
      .toMatch(/Access denied/);
  });

  it("data přežila oba průchody heals beze změny; služba dál vidí oba vlastníky", () => {
    expect(stav.poOtisk).toBe(stav.predOtisk);
    expect(stav.poDruhem).toBe(stav.predOtisk);
    for (const p of POHLEDY_STAVU) expect(viditelni({ role: "service_role" }, p), p).toBe(oba);
  });
});
