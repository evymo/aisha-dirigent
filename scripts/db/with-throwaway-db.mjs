#!/usr/bin/env node
/**
 * with-throwaway-db.mjs — run a command against a CLEAN, disposable PostgreSQL
 *
 * Stands up a throwaway DB from the canonical infra/postgres substrate (pgvector +
 * pgaudit + roles), applies baseline + all migrations + the compiled seed, sets
 * the AISHA_DB_* env vars so the test harness (src/tests/db/test-env-probe.ts +
 * validation-utils.ts) connects to it, runs the passed command, and tears the
 * container down.
 *
 * WHY this exists — the db-runtime tests (src/tests/db/*-runtime.test.ts +
 * schema/seed validation) must REALLY run, not skip. They default to
 * postgres:postgres@127.0.0.1:54322, but:
 *   - a running local-warmup stack (aisha-local__aisha-db) occupies 54322 with
 *     a GENERATED password → host auth fails → tests error out instead of
 *     exercising anything;
 *   - the cold-start / e2e stack uses scram + generated creds too.
 * A clean throwaway DB on its OWN port with known creds is the only way to run
 * these tests deterministically. Mirrors what CI's cold-start verify job does
 * (postgres:ci + baseline + seed.compiled.sql), but self-contained and local.
 *
 * Usage:
 *   node scripts/db/with-throwaway-db.mjs -- <command> [args...]
 *   npm run test:db                       # = ... -- npx vitest run src/tests/db
 *
 * Env overrides:
 *   AISHA_THROWAWAY_DB_IMAGE  existing DB image (default: aisha-db-throwaway:pg<POSTGRES_MAJOR>-<otisk infra/postgres>,
 *                        built once from infra/postgres/Dockerfile, then cached)
 *   POSTGRES_MAJOR       major verze obrazu (default: config/image-versions.env)
 *   AISHA_TESTDB_PORT    host port for the throwaway DB (default: auto-pick)
 *   AISHA_TESTDB_KEEP=1  leave the container running afterwards (debug/reuse)
 *   AISHA_TESTDB_NO_SEED=1  apply baseline+migrations only, skip the seed
 *
 * Exit code = the wrapped command's exit code (so it gates pre-push/CI).
 *
 * @module
 */
import { execFileSync, spawnSync } from "child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { createServer } from "net";
import path from "path";
import { fileURLToPath } from "url";
import { psqlPripojeni } from "./lib/psql-pripojeni.mjs";
import { resolveReachable } from "../lib/reachable-endpoint.mjs";
import { argumentyTajemstvi } from "../lib/throwaway-db-tajemstvi.mjs";
import { registryProxyBuildArgs } from "../lib/registry-proxy.mjs";
import { postgresMajor, postgresMajorBuildArgs } from "../lib/postgres-major.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// Přejmenováno (major verze je parametr): staré jméno proměnné by jinak tiše
// ztratilo účinek a skript by postavil jiný obraz, než kdo volal chtěl.
if (process.env.AISHA_PG17_IMAGE) {
  console.error("❌ AISHA_PG17_IMAGE bylo přejmenováno na AISHA_THROWAWAY_DB_IMAGE (major verze je parametr POSTGRES_MAJOR).");
  process.exit(1);
}
const PG_MAJOR = postgresMajor();
/**
 * Otisk OBSAHU build kontextu (infra/postgres) — část tagu výchozího obrazu.
 *
 * ⛔ Dřív byl tag jen `aisha-db-throwaway:pg<major>` a obraz se postavil JEDNOU:
 * změna entrypointu nebo initdb skriptu se do testů nedostala, dokud někdo ručně
 * nesmazal obraz — lokálně i na CI runneru s keší. Test pak měřil STARÝ obraz.
 * (Naraženo 2026-09-25: klíče šifrování se přestěhovaly z GUC do souborů, které
 * zapisuje entrypoint — se starým obrazem by helpery soubor nenašly.) Otisk bere
 * pracovní soubory, ne git strom, aby platil i pro necommitnuté úpravy.
 */
function otiskKontextuDb() {
  const koren = path.join(ROOT, "infra/postgres");
  const h = createHash("sha256");
  const projdi = (dir) => {
    for (const jmeno of readdirSync(dir).sort()) {
      const abs = path.join(dir, jmeno);
      if (statSync(abs).isDirectory()) projdi(abs);
      else h.update(path.relative(koren, abs)).update("\0").update(readFileSync(abs)).update("\0");
    }
  };
  projdi(koren);
  return h.digest("hex").slice(0, 12);
}
// Tag nese major verzi (obraz 17 z cache se nesmí vzít, když se měří 18) a otisk
// kontextu (obraz starého entrypointu se nesmí vzít, když se měří nový).
const DEFAULT_IMAGE = `aisha-db-throwaway:pg${PG_MAJOR}-${otiskKontextuDb()}`;
const IMAGE = process.env.AISHA_THROWAWAY_DB_IMAGE || DEFAULT_IMAGE;
/**
 * Jméno kontejneru MUSÍ být per-běh unikátní. Port se odjakživa vybíral volný,
 * ale jméno bylo pevné — a to nestačí: na jednom runneru běží tři těžké DB lane
 * (Surfaces, Blockchain, DB kontrakt) vedle sebe a všechny volají tenhle skript.
 *
 * Naměřeno v běhu 514: jedna lane kontejner odstranila pod druhou
 * (`connection to server was lost` uprostřed migrate.mjs) a jiná pod třetí
 * zahodila `public` schéma (`type "app_role" does not exist` při heals.sql).
 * Dvě různé hlášky, jedna příčina — a obě vypadaly jako vada měněného kódu.
 *
 * AISHA_TESTDB_CONTAINER umožní jméno určit (ladění, ruční úklid); jinak se
 * odvodí z PID a náhody, takže se dvě souběžné lane nemohou potkat.
 */
const CONTAINER =
  process.env.AISHA_TESTDB_CONTAINER ||
  `aisha-testdb-throwaway-${process.pid}-${randomBytes(3).toString("hex")}`;
const PASSWORD = "postgres";
const KEEP = process.env.AISHA_TESTDB_KEEP === "1";
const NO_SEED = process.env.AISHA_TESTDB_NO_SEED === "1";
const READY_TIMEOUT_MS = 120_000;
const SEED_FILE = path.join(ROOT, "aisha/db/seed.compiled.sql");

// Everything after the first standalone `--` is the command to run with the DB.
const dashIdx = process.argv.indexOf("--");
const command = dashIdx >= 0 ? process.argv.slice(dashIdx + 1) : [];
if (command.length === 0) {
  console.error("Usage: node scripts/db/with-throwaway-db.mjs -- <command> [args...]");
  process.exit(2);
}

function inherit(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });
}
function capture(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf-8" });
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}
function dockerAvailable() {
  return capture("docker", ["version", "--format", "{{.Server.Version}}"]).code === 0;
}
function imageExists(img) {
  return capture("docker", ["image", "inspect", img]).code === 0;
}

function pickPort(preferred) {
  function tryBind(port) {
    return new Promise((resolve) => {
      const srv = createServer();
      srv.once("error", () => resolve(null));
      srv.once("listening", () => {
        const chosen = srv.address().port;
        srv.close(() => resolve(chosen));
      });
      srv.listen(port, "127.0.0.1");
    });
  }
  return preferred ? tryBind(preferred).then((p) => p ?? tryBind(0)) : tryBind(0);
}

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (KEEP) {
    console.log(`\n🧪 AISHA_TESTDB_KEEP=1 — leaving ${CONTAINER} running (remove with: docker rm -f -v ${CONTAINER})`);
    return;
  }
  spawnSync("docker", ["rm", "-f", "-v", CONTAINER], { stdio: "ignore" });
}

async function main() {
  if (!dockerAvailable()) {
    console.error("❌ Docker is not available — start Docker and retry.");
    process.exit(1);
  }
  if (!existsSync(SEED_FILE) && !NO_SEED) {
    console.error(`❌ Seed not found: ${SEED_FILE} — run \`npm run db:seed:compile\` first, or set AISHA_TESTDB_NO_SEED=1.`);
    process.exit(1);
  }

  if (!imageExists(IMAGE)) {
    if (process.env.AISHA_THROWAWAY_DB_IMAGE) {
      console.error(`❌ AISHA_THROWAWAY_DB_IMAGE='${IMAGE}' not found locally.`);
      process.exit(1);
    }
    console.log(`🔨 Building throwaway DB image '${IMAGE}' from infra/postgres (one-time, cached after)…`);
    inherit("docker", ["build", ...registryProxyBuildArgs(), ...postgresMajorBuildArgs(), "-t", IMAGE, "-f", "infra/postgres/Dockerfile", "infra/postgres"]);
  } else {
    console.log(`📦 Reusing DB image: ${IMAGE}`);
  }

  // Remove any stale container from a previous interrupted run.
  spawnSync("docker", ["rm", "-f", "-v", CONTAINER], { stdio: "ignore" });

  // `let`, ne `const`: při kolizi v prostoru DinD démona se níž zkouší jiný port.
  let port = await pickPort(Number(process.env.AISHA_TESTDB_PORT) || 57601);
  // The endpoint THIS process uses to reach the DB. Starts as the published
  // 127.0.0.1:port; re-resolved after boot to the container bridge IP:5432 if the
  // runner's DinD does not bridge published ports to the job (see resolveReachable).
  let dbHost = "127.0.0.1";
  let dbPort = String(port);
  let dbUrl = `postgresql://postgres:${PASSWORD}@${dbHost}:${dbPort}/postgres`;

  process.on("SIGINT", () => { cleanup(); process.exit(130); });
  process.on("SIGTERM", () => { cleanup(); process.exit(143); });

  let exitCode = 0;
  try {
    console.log(`🚀 Starting throwaway test DB '${CONTAINER}' on 127.0.0.1:${port}…`);
    // Tajemství prvního startu (env soubor, jinak efemérní klíče) — jeden domov
    // v lib/throwaway-db-tajemstvi.mjs, sdílený s types-refresh-throwaway.mjs.
    // Bez nich init skončí „VAULT_ENCRYPTION_KEY must be set" (tím kdysi padla
    // blockchain integrační lane).
    const tajemstviArgs = argumentyTajemstvi(ROOT);
    // `pickPort` zkouší vazbu V TOMHLE procesu, ale publikuje se v prostoru DinD
    // démona — jiný síťový namespace. Port volný tady tedy může být obsazený tam,
    // a `docker run` skončí „port is already allocated“. Naměřeno v běhu 516: dvě
    // souběžné lane dostaly obě výchozích 57601.
    //
    // Ověřit to dopředu nejde (démon nemusí být lokální), tak se to řeší tím, co
    // spolehlivě funguje: zkusit znovu na jiném portu. Kolize je vzácná a druhé
    // kolo už si port bere náhodný, takže dvě opakování stačí s rezervou.
    const runArgs = (p) => [
      "run", "-d", "--name", CONTAINER,
      ...tajemstviArgs,
      // Explicit -e after the file/CI args so the throwaway's known POSTGRES_* win.
      "-e", "POSTGRES_USER=postgres",
      "-e", `POSTGRES_PASSWORD=${PASSWORD}`,
      "-e", "POSTGRES_DB=postgres",
      "-p", `127.0.0.1:${p}:5432`,
      IMAGE,
    ];
    for (let attempt = 0; ; attempt++) {
      const res = capture("docker", runArgs(port));
      if (res.code === 0) break;
      const allocated = /port is already allocated|address already in use/i.test(res.out || "");
      if (!allocated || attempt >= 2) {
        console.error(res.out);
        throw new Error(`docker run failed for ${CONTAINER} on port ${port}`);
      }
      // Kontejner mohl vzniknout a spadnout až na publikaci portu — uklidit, jinak
      // druhý pokus narazí na obsazené jméno a hlásil by úplně jinou příčinu.
      spawnSync("docker", ["rm", "-f", "-v", CONTAINER], { stdio: "ignore" });
      port = await pickPort(0);
      // dbPort/dbUrl se odvozují z portu VÝŠE, tedy ještě před tímhle opakováním —
      // bez přepočtu by ukazovaly na port, na kterém nakonec nic neběží.
      dbPort = String(port);
      dbUrl = `postgresql://postgres:${PASSWORD}@${dbHost}:${dbPort}/postgres`;
      console.log(`⚠️  port obsazený v prostoru démona — zkouším znovu na 127.0.0.1:${port}`);
    }

    console.log("⏳ Waiting for first-boot init (roles + GUCs)…");
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let ready = false;
    while (Date.now() < deadline) {
      if (capture("docker", ["exec", CONTAINER, "test", "-f", "/tmp/.db-passwords-ready"]).code === 0) {
        ready = true;
        break;
      }
      spawnSync("sleep", ["2"]);
    }
    if (!ready) {
      console.error(`❌ DB did not become ready within ${READY_TIMEOUT_MS / 1000}s. Recent logs:`);
      console.error(capture("docker", ["logs", "--tail", "40", CONTAINER]).out);
      process.exit(1);
    }

    // Resolve a job-reachable endpoint. On this CI's DinD the published
    // 127.0.0.1:port does NOT bridge to the job (it lands on the daemon host), but
    // the container bridge IP:5432 does — so probe both and use whichever opens.
    const ep = await resolveReachable({ container: CONTAINER, inPort: 5432, host: "127.0.0.1", port, timeoutMs: 30_000 });
    if (!ep) {
      console.error(`❌ DB unreachable on 127.0.0.1:${port} AND its container IP:5432. Recent logs:`);
      console.error(capture("docker", ["logs", "--tail", "40", CONTAINER]).out);
      process.exit(1);
    }
    dbHost = ep.host;
    dbPort = ep.port;
    dbUrl = `postgresql://postgres:${PASSWORD}@${dbHost}:${dbPort}/postgres`;
    if (ep.via !== "published") {
      console.log(`ℹ️  DB reachable via ${ep.via} at ${dbHost}:${dbPort} (DinD published port not bridged to the job)`);
    }

    // The marker is touched right after set-passwords.sh, but the pg17
    // entrypoint does a FINAL server restart once the initdb scripts finish —
    // a bare connect during that window dies with "server closed the connection
    // unexpectedly". Poll a real authenticated `SELECT 1` from the host so we
    // only proceed once PG is genuinely accepting authenticated connections.
    // ⭐ MĚŘÍ SE STABILITA, NE JEDEN ÚSPĚCH.
    //
    // Do 2026-08-04 stačila JEDNA úspěšná `SELECT 1` a šlo se dál. Jenže jeden
    // úspěch je plně slučitelný s „server se za vteřinu restartuje": entrypoint
    // pg17 restartuje PO doběhnutí initdb skriptů (viz komentář výš), takže se
    // sonda trefí do okna PŘED restartem, prohlásí hotovo — a `migrate.mjs`
    // pak spadne na `Connection refused`. Naměřeno na CI (běh 503, job 26):
    // sonda prošla a migrate za pár vteřin na tutéž adresu už nedosáhl.
    //
    // Vlastnost, kterou opravdu potřebujeme, není „šlo to zrovna teď", ale
    // „server DRŽÍ". Proto se vyžadují TŘI po sobě jdoucí úspěchy po sekundě:
    // restart mezi ně spadne a čítač shodí zpátky na nulu. Delší sleep by tutéž
    // vadu jen zředil — čeká se na VLASTNOST, ne na čas.
    console.log("⏳ Waiting for authenticated connections to settle…");
    const AUTH_STREAK = 3;
    const authDeadline = Date.now() + 60_000;
    let streak = 0;
    while (Date.now() < authDeadline && streak < AUTH_STREAK) {
      const pripojeni = psqlPripojeni(dbUrl); // heslo prostředím, ne v argv
      const probe = spawnSync(
        "psql",
        [pripojeni.cil, "-tAc", "SELECT 1"],
        { encoding: "utf-8", env: pripojeni.env },
      );
      streak = probe.status === 0 ? streak + 1 : 0;
      if (streak < AUTH_STREAK) spawnSync("sleep", ["1"]);
    }
    if (streak < AUTH_STREAK) {
      console.error(
        `❌ DB nedržela ${AUTH_STREAK} po sobě jdoucí ověřená připojení do 60s `
        + `(nejdelší série ${streak}). Recent logs:`
      );
      console.error(capture("docker", ["logs", "--tail", "40", CONTAINER]).out);
      process.exit(1);
    }

    // Always apply the CURRENT baseline fresh. The throwaway DB is ephemeral, but a
    // reused/pre-baked aisha-db-throwaway image on a CI runner can carry a STALE
    // baseline; migrate.mjs records the baseline with a NULL checksum and never
    // re-applies it (by design — heals is the incremental path), so it would "adopt"
    // that stale baseline and then fail applying the CURRENT heals.sql against it
    // (e.g. `function public.set_updated_at() does not exist`). Forcing the reset
    // (drop public schema + re-apply baseline) makes the throwaway deterministic and
    // independent of any cached image state — exactly what a faithful test DB needs.
    const migrateEnv = { ...process.env, AISHA_DB_URL: dbUrl, AISHA_DB_FORCE_BASELINE_RESET: "1" };

    console.log("\n📦 Applying baseline + all migrations (forced fresh baseline)…");
    inherit("node", ["scripts/db/migrate.mjs"], { env: migrateEnv });

    if (!NO_SEED) {
      console.log("\n🌱 Applying compiled seed…");
      const pripojeni = psqlPripojeni(dbUrl); // heslo prostředím, ne v argv
      inherit("psql", [pripojeni.cil, "-v", "ON_ERROR_STOP=1", "-q", "-f", "aisha/db/seed.compiled.sql"], {
        env: pripojeni.env,
      });
    }

    // The test harness reads AISHA_DB_* (test-env-probe.ts) — point it at the
    // throwaway DB so isPgReachable()/validation-utils connect + authenticate.
    const runEnv = {
      ...process.env,
      AISHA_DB_HOST: dbHost,
      AISHA_DB_PORT: dbPort,
      AISHA_DB_USER: "postgres",
      AISHA_DB_PASSWORD: PASSWORD,
      AISHA_DB_NAME: "postgres",
      AISHA_DB_URL: dbUrl,
      PGPASSWORD: PASSWORD,
      // Jméno kontejneru se předává, ne duplikuje. with-throwaway-postgrest.mjs
      // ho potřebuje pro `docker network connect` a pro URI přes docker DNS;
      // dokud bylo na obou stranách natvrdo, drželo to jen náhodou.
      AISHA_TESTDB_CONTAINER: CONTAINER,
      // Okamžik, kdy DB dostala baseline + seed a ještě na ni nesáhl žádný test.
      // Kontroly „seed nechává tabulku prázdnou" (schema-validation-v2) podle něj
      // počítají jen řádky z doby PŘED testy — v souběžné sadě jinak viděly
      // přechodné fixtury jiných souborů (naměřeno 2026-10-05: news_articles).
      AISHA_TESTDB_SEED_AT: new Date().toISOString(),
    };

    console.log(`\n🧪 Running: ${command.join(" ")}\n`);
    try {
      inherit(command[0], command.slice(1), { env: runEnv });
    } catch (err) {
      exitCode = typeof err?.status === "number" ? err.status : 1;
    }
  } finally {
    cleanup();
  }
  process.exit(exitCode);
}

main().catch((err) => {
  cleanup();
  console.error(`❌ with-throwaway-db failed: ${err.message}`);
  process.exit(1);
});
