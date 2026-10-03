#!/usr/bin/env node
/**
 * Throwaway-DB type/schema refresh
 *
 * Regenerates src/integrations/db/types.ts against a DISPOSABLE PostgreSQL
 * container built from the canonical infra/postgres substrate — instead of the
 * developer's running stack.
 *
 * Why this exists: the db:*:local scripts hardcode
 * `postgres:postgres@127.0.0.1:57422`, but the cold-start / e2e stack that is
 * usually running locally is provisioned with a GENERATED password and only
 * trusts in-container auth (host connections via Docker's port-forward hit the
 * `scram-sha-256` rule). So `db:types:gen:local` / `db:migrate:local` fail
 * against it. This script stands up a clean DB with known throwaway creds,
 * applies baseline + all migrations, regenerates types, and tears the container
 * down — never touching the running stack, never reusing its secret.
 *
 * This is the faithful path: a pure baseline + migrations schema is the SoT
 * shape, so the generated typed RPC union matches what the running stack would
 * produce once both are at the same migration head.
 *
 * Usage:
 *   npm run db:types:refresh:throwaway
 *
 * Env overrides:
 *   AISHA_THROWAWAY_DB_IMAGE  use an existing DB image instead of building one
 *   POSTGRES_MAJOR       major verze obrazu (default: config/image-versions.env)
 *                        (default: build `aisha-db-throwaway:latest` from
 *                        infra/postgres/Dockerfile — cached after first run)
 *   AISHA_TYPEGEN_PORT   host port for the throwaway DB (default: auto-pick)
 *   AISHA_TYPEGEN_KEEP=1 leave the container running afterwards (debug)
 *   AISHA_TYPEGEN_CONTAINER  explicit container name (debug / manual cleanup);
 *                        default = unique per run `aisha-typegen-throwaway-<pid>-<hex>`
 *
 * ⛔ CONTAINER NAME IS PER RUN (2026-09-30). It used to be FIXED and every run began
 *    with `docker rm -f` of that name — two sessions on one machine deleted each
 *    other's database mid-run (truncated types, "server closed the connection"
 *    mid-baseline, "connection refused"). Now each run has its own name and the
 *    start-up cleanup removes ONLY containers of runs whose process is gone
 *    (lib/throwaway-kontejner.mjs) — a live run of another session is never touched.
 *
 * @module
 */
import { execFileSync, spawnSync } from "child_process";
import { createServer } from "net";
import path from "path";
import { fileURLToPath } from "url";
import { psqlPripojeni } from "./lib/psql-pripojeni.mjs";
import { registryProxyBuildArgs } from "../lib/registry-proxy.mjs";
import { argumentyTajemstvi } from "../lib/throwaway-db-tajemstvi.mjs";
import { postgresMajor, postgresMajorBuildArgs } from "../lib/postgres-major.mjs";
import { jmenoKontejneru, mrtveKontejnery, procesZije } from "./lib/throwaway-kontejner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// Přejmenováno (major verze je parametr): staré jméno proměnné by jinak tiše
// ztratilo účinek a skript by postavil jiný obraz, než kdo volal chtěl.
if (process.env.AISHA_PG17_IMAGE) {
  console.error("❌ AISHA_PG17_IMAGE bylo přejmenováno na AISHA_THROWAWAY_DB_IMAGE (major verze je parametr POSTGRES_MAJOR).");
  process.exit(1);
}
const PG_MAJOR = postgresMajor();
// Tag nese major verzi: obraz 17 z lokální cache se nesmí vzít, když se měří 18.
const DEFAULT_IMAGE = `aisha-db-throwaway:pg${PG_MAJOR}`;
const IMAGE = process.env.AISHA_THROWAWAY_DB_IMAGE || DEFAULT_IMAGE;
const PREFIX = "aisha-typegen-throwaway";
const CONTAINER_EXPLICIT = Boolean(process.env.AISHA_TYPEGEN_CONTAINER?.trim());
const CONTAINER = jmenoKontejneru(PREFIX, { override: process.env.AISHA_TYPEGEN_CONTAINER });
const PASSWORD = "postgres";
const KEEP = process.env.AISHA_TYPEGEN_KEEP === "1";
const READY_TIMEOUT_MS = 120_000;

function inherit(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });
}

function capture(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf-8", ...opts });
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function dockerAvailable() {
  return capture("docker", ["version", "--format", "{{.Server.Version}}"]).code === 0;
}

function imageExists(img) {
  return capture("docker", ["image", "inspect", img]).code === 0;
}

function pickPort(preferred) {
  // Bind to 0 to let the OS hand us a free port; if a preferred port is given
  // and bindable, use it. Small TOCTOU window before `docker run` — acceptable
  // for a dev-only throwaway.
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
    console.log(`\n🧪 AISHA_TYPEGEN_KEEP=1 — leaving ${CONTAINER} running (remove with: docker rm -f -v ${CONTAINER})`);
    return;
  }
  spawnSync("docker", ["rm", "-f", "-v", CONTAINER], { stdio: "ignore" });
}

async function main() {
  if (!dockerAvailable()) {
    console.error("❌ Docker is not available — start Docker and retry.");
    process.exit(1);
  }

  // Resolve the DB image: explicit override must exist; default tag is built
  // from the canonical Dockerfile on first use (docker layer cache makes
  // subsequent runs fast).
  if (process.env.AISHA_THROWAWAY_DB_IMAGE) {
    if (!imageExists(IMAGE)) {
      console.error(`❌ AISHA_THROWAWAY_DB_IMAGE='${IMAGE}' not found locally.`);
      process.exit(1);
    }
    console.log(`📦 Using DB image: ${IMAGE}`);
  } else if (!imageExists(IMAGE)) {
    console.log(`🔨 Building throwaway DB image '${IMAGE}' from infra/postgres (one-time, cached after)…`);
    // Context = infra/postgres (NOT repo root): the image only needs those 5 files;
    // a tiny context avoids streaming the whole repo to the daemon.
    inherit("docker", ["build", ...registryProxyBuildArgs(), ...postgresMajorBuildArgs(), "-t", IMAGE, "-f", "infra/postgres/Dockerfile", "infra/postgres"]);
  } else {
    console.log(`📦 Reusing DB image: ${IMAGE}`);
  }

  // Úklid po PŘERUŠENÝCH bězích — jen kontejnery, jejichž proces už neběží. Živý běh
  // jiné relace se nechává být (viz hlavička). Výslovné jméno = volající ví, co dělá:
  // chová se jako dřív (odstraní jen svůj pojmenovaný kontejner).
  if (CONTAINER_EXPLICIT) {
    spawnSync("docker", ["rm", "-f", "-v", CONTAINER], { stdio: "ignore" });
  } else {
    const ps = capture("docker", ["ps", "-a", "--filter", `name=^${PREFIX}-`, "--format", "{{.Names}}"]);
    const stare = ps.code === 0 ? mrtveKontejnery(ps.out.split("\n").map((x) => x.trim()).filter(Boolean), PREFIX, procesZije) : [];
    for (const jmeno of stare) spawnSync("docker", ["rm", "-f", "-v", jmeno], { stdio: "ignore" });
    if (stare.length) console.log(`🧹 Removed ${stare.length} container(s) left by interrupted runs`);
  }

  const port = await pickPort(Number(process.env.AISHA_TYPEGEN_PORT) || 57599);
  const dbUrl = `postgresql://postgres:${PASSWORD}@127.0.0.1:${port}/postgres`;

  // Guarantee teardown on Ctrl-C / kill.
  process.on("SIGINT", () => { cleanup(); process.exit(130); });
  process.on("SIGTERM", () => { cleanup(); process.exit(143); });

  try {
    console.log(`🚀 Starting throwaway DB '${CONTAINER}' on 127.0.0.1:${port}…`);
    // Tajemství prvního startu — týž domov jako with-throwaway-db.mjs
    // (lib/throwaway-db-tajemstvi.mjs): env soubor, jinak efemérní klíče.
    // ⛔ 2026-09-25: tady chyběly efemérní klíče → čerstvý worktree bez
    // .env.local.dev padal na „VAULT_ENCRYPTION_KEY must be set".
    // PŘED výslovnými -e, aby vlastní POSTGRES_* zahazovací DB vyhrály.
    const tajemstviArgs = argumentyTajemstvi(ROOT);
    inherit("docker", [
      "run", "-d", "--name", CONTAINER,
      ...tajemstviArgs,
      "-e", "POSTGRES_USER=postgres",
      "-e", `POSTGRES_PASSWORD=${PASSWORD}`,
      "-e", "POSTGRES_DB=postgres",
      "-p", `127.0.0.1:${port}:5432`,
      IMAGE,
    ]);

    // First-boot init (set-passwords.sh) writes this marker when roles + GUCs
    // are ready. pg_isready alone is not enough — roles aren't set yet.
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

    // The marker only proves the init SCRIPTS ran — and postgres runs those
    // against a temporary unix-socket-only server, then RESTARTS to listen on
    // TCP. So the marker can be present while a host client still gets
    // "server closed the connection unexpectedly" (measured 2026-07-26: the
    // run died there, in migrate.mjs, after a green readiness wait). Probe the
    // way the CONSUMER connects — over TCP, with the real URL — before handing
    // the container to any child process.
    console.log("⏳ Waiting for TCP acceptance (post-init restart)…");
    const tcpDeadline = Date.now() + READY_TIMEOUT_MS;
    let serving = false;
    while (Date.now() < tcpDeadline) {
      // Týž cíl i ověření jako u konzumenta, jen heslo prostředím, ne v argv.
      const pripojeni = psqlPripojeni(dbUrl);
      if (capture("psql", [pripojeni.cil, "-tAc", "select 1"], { env: pripojeni.env }).code === 0) {
        serving = true;
        break;
      }
      spawnSync("sleep", ["2"]);
    }
    if (!serving) {
      console.error(`❌ DB never accepted a TCP connection within ${READY_TIMEOUT_MS / 1000}s. Recent logs:`);
      console.error(capture("docker", ["logs", "--tail", "40", CONTAINER]).out);
      process.exit(1);
    }

    // Children inherit a throwaway connection string + a satisfied .npmrc token.
    const env = {
      ...process.env,
      AISHA_DB_URL: dbUrl,
      VERDACCIO_TOKEN: process.env.VERDACCIO_TOKEN ?? "",
    };

    console.log("\n📦 Applying baseline + all migrations…");
    inherit("node", ["scripts/db/migrate.mjs"], { env });

    console.log("\n🔧 Regenerating src/integrations/db/types.ts…");
    inherit("node", ["scripts/db/gen-types.mjs"], { env });

    console.log("\n✅ Types regenerated against a clean SoT schema (baseline + migrations).");
    console.log("   Next: review the diff, then if the frontend strict-mode count changed:");
    console.log("      npm run gen:frontend-typecheck:baseline && npm run gen:frontend-typecheck:check");
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  cleanup();
  console.error(`❌ throwaway type refresh failed: ${err.message}`);
  process.exit(1);
});
