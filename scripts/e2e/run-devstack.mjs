/**
 * Fully-automatic Playwright e2e against the LOCAL dev stack.
 *
 * This is the local-warmup twin of scripts/e2e/run-local.mjs: instead of the
 * heavy Coolify e2e compose (which needs live Coolify discovery for ~67 env
 * vars), it drives the env-complete-by-construction `aisha-local` dev stack
 * (`npm run dev:stack` → local-warmup --preset optimum --seed-profile dev).
 *
 * One command, no manual steps:
 *   1. ensure the dev stack is up + healthy (brings it up if not)
 *   2. provision the deterministic admin/member/partner users (KC + DB, idempotent)
 *   3. start vite with VITE_E2E=true pointed at the dev stack
 *   4. run Playwright (auth.setup mints ROPC tokens + injects them; specs run)
 *   5. tear the vite dev server down
 *
 * Run:  npm run test:e2e:devstack -- workbench-surfacing.spec.ts
 *
 * Knobs (env):
 *   DEVSTACK_SKIP_UP=1     don't bring the stack up even if unhealthy (fail fast)
 *   DEVSTACK_SKIP_PROVISION=1   skip KC/DB user provisioning (already provisioned)
 *   DEVSTACK_WEB_PORT=4173      vite port / Playwright origin (must be CORS-allowed)
 *   DEVSTACK_GATEWAY_URL, DEVSTACK_KC_URL   override the dev stack endpoints
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const PLAYWRIGHT_ARGS = process.argv.slice(2);

const GATEWAY_URL = process.env.DEVSTACK_GATEWAY_URL ?? "http://127.0.0.1:3001";
const KC_URL = process.env.DEVSTACK_KC_URL ?? "http://127.0.0.1:8180";
const KC_REALM = process.env.DEVSTACK_KC_REALM ?? "aisha";
const KC_AUTHORITY = `${KC_URL.replace(/\/$/, "")}/realms/${KC_REALM}`;
const KC_CLIENT_ID = process.env.DEVSTACK_KC_CLIENT_ID ?? "aisha-app";
const WEB_PORT = process.env.DEVSTACK_WEB_PORT ?? "4173";
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;

const COMPOSE_PROJECT =
  process.env.DEVSTACK_PROJECT ?? process.env.AISHA_LOCAL_STACK ?? "aisha-local";
const COMPOSE_FILE = process.env.DEVSTACK_COMPOSE ?? "docker-compose.local.generated.json";
const ENV_FILE = process.env.DEVSTACK_ENV_FILE ?? ".env.local.dev";
const COMPOSE = ["compose", "-p", COMPOSE_PROJECT, "-f", COMPOSE_FILE, "--env-file", ENV_FILE];

function run(command, args, label, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: "inherit", ...opts });
    child.on("error", (e) => reject(e instanceof Error ? e : new Error(String(e))));
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${label} failed with exit code ${code ?? 1}`)),
    );
  });
}

function runWithInput(command, args, input, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: ["pipe", "inherit", "inherit"] });
    child.on("error", (e) => reject(e instanceof Error ? e : new Error(String(e))));
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${label} failed with exit code ${code ?? 1}`)),
    );
    child.stdin.end(input);
  });
}

async function runOptional(command, args, label) {
  try {
    await run(command, args, label);
  } catch (e) {
    console.warn(`[devstack] ${label} failed (continuing): ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function waitForHttp(url, { attempts = 60, delayMs = 2000, ok = (r) => r.ok } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      if (ok(await fetch(url, { signal: ctrl.signal }))) return true;
    } catch (err) {
      // Transient pre-readiness probe failure — keep polling, but surface it
      // under DEVSTACK_VERBOSE so a genuinely-stuck stack is diagnosable.
      if (process.env.DEVSTACK_VERBOSE) {
        console.warn(`waitForHttp ${url} attempt ${i + 1} failed: ${err instanceof Error ? err.message : err}`);
      }
    } finally {
      clearTimeout(t);
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

async function isHealthy() {
  return waitForHttp(`${GATEWAY_URL}/health`, { attempts: 1, delayMs: 0 });
}

async function fetchAnonKey() {
  const res = await fetch(`${GATEWAY_URL}/.well-known/app-config.json`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`app-config fetch failed: ${res.status}`);
  const cfg = await res.json();
  const anon = cfg?.anon_key;
  if (typeof anon !== "string" || anon.length < 20) {
    throw new Error("app-config did not include a usable anon_key");
  }
  return anon;
}

async function ensureStackUp() {
  if (await isHealthy()) {
    console.log(`[devstack] dev stack already healthy at ${GATEWAY_URL}`);
    return;
  }
  if (process.env.DEVSTACK_SKIP_UP === "1") {
    throw new Error(`dev stack not healthy at ${GATEWAY_URL} and DEVSTACK_SKIP_UP=1`);
  }
  console.log("[devstack] dev stack not healthy — bringing it up (local-warmup --preset optimum --seed-profile dev)...");
  await run("bash", ["scripts/local-warmup.sh", "--preset", "optimum", "--seed-profile", "dev"], "local-warmup dev stack");
  console.log(`[devstack] waiting for gateway at ${GATEWAY_URL}...`);
  if (!(await waitForHttp(`${GATEWAY_URL}/health`, { attempts: 120 }))) {
    throw new Error("gateway did not become healthy after local-warmup");
  }
}

function sqlLiteral(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function provisionUsers() {
  if (process.env.DEVSTACK_SKIP_PROVISION === "1") {
    console.log("[devstack] skipping user provisioning (DEVSTACK_SKIP_PROVISION=1)");
    return;
  }
  console.log("[devstack] applying deterministic e2e DB seed (idempotent)...");
  const seed = readFileSync("aisha/db/seed.e2e.sql", "utf8");
  await runWithInput(
    "docker",
    [...COMPOSE, "exec", "-T", "db", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
    seed,
    "apply e2e DB seed",
  );

  console.log("[devstack] provisioning Keycloak realm users (admin/member/partner/staff)...");
  // provision-e2e.sh reads KC admin creds from the container env (KEYCLOAK_ADMIN /
  // KEYCLOAK_ADMIN_PASSWORD), so no secrets pass through this process.
  await runOptional(
    "docker",
    [...COMPOSE, "exec", "-T", "keycloak", "bash", "/opt/keycloak/provision-e2e.sh"],
    "keycloak e2e provisioning",
  );

  console.log("[devstack] syncing Keycloak subject ids into aisha_auth.identities...");
  const users = [
    ["e2e00000-0000-0000-0000-000000000001", "admin@platform.rtn"],
    ["e2e00000-0000-0000-0000-000000000002", "member@platform.rtn"],
    ["e2e00000-0000-0000-0000-000000000003", "partner@platform.rtn"],
    ["e2e00000-0000-0000-0000-000000000004", "staff@platform.rtn"],
  ];
  const ids = await keycloakUserIds(users.map(([, email]) => email));
  const values = users
    .filter(([, email]) => ids.get(email))
    .map(([uid, email]) => `(${sqlLiteral(uid)}::uuid, ${sqlLiteral(email)}, ${sqlLiteral(ids.get(email))})`);
  if (values.length === 0) {
    console.warn("[devstack] no Keycloak user ids resolved — leaving identity mappings as-is");
    return;
  }
  const sql = `
WITH e2e_users(user_id, email, provider_id) AS ( VALUES ${values.join(",\n  ")} )
DELETE FROM aisha_auth.identities i USING e2e_users e
 WHERE i.provider = 'keycloak' AND i.email = e.email;
WITH e2e_users(user_id, email, provider_id) AS ( VALUES ${values.join(",\n  ")} )
INSERT INTO aisha_auth.identities (user_id, provider, provider_id, email, identity_data, updated_at, last_sign_in_at)
SELECT e.user_id, 'keycloak', e.provider_id, e.email,
       jsonb_build_object('sub', e.provider_id, 'email', e.email, 'app_user_id', e.user_id),
       now(), now()
FROM e2e_users e
ON CONFLICT (provider, provider_id) DO UPDATE
  SET user_id = EXCLUDED.user_id, email = EXCLUDED.email,
      identity_data = EXCLUDED.identity_data, updated_at = now(), last_sign_in_at = now();`;
  await run(
    "docker",
    [...COMPOSE, "exec", "-T", "db", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", sql],
    "sync e2e identity mappings",
  );
}

async function keycloakAdminToken() {
  // The dev KC container exposes the bootstrap admin creds in its env; read them
  // so this stays secret-free in the repo.
  const out = await dockerExecCapture([...COMPOSE, "exec", "-T", "keycloak", "printenv"]);
  const env = Object.fromEntries(
    out.split("\n").map((l) => {
      const i = l.indexOf("=");
      return i === -1 ? [l, ""] : [l.slice(0, i), l.slice(i + 1)];
    }),
  );
  const username = env.KC_ADMIN_USER ?? env.KEYCLOAK_ADMIN ?? "admin";
  const password = env.KC_ADMIN_PASS ?? env.KEYCLOAK_ADMIN_PASSWORD;
  if (!password) throw new Error("could not read dev Keycloak admin password from the container env");
  const res = await fetch(`${KC_URL}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", client_id: "admin-cli", username, password }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`KC admin token failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function keycloakUserIds(emails) {
  const token = await keycloakAdminToken();
  const map = new Map();
  for (const email of emails) {
    const params = new URLSearchParams({ username: email, exact: "true", briefRepresentation: "true", max: "5" });
    const res = await fetch(`${KC_URL}/admin/realms/${KC_REALM}/users?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) continue;
    const list = await res.json();
    const user = Array.isArray(list) ? list.find((u) => u?.username === email) : null;
    if (user?.id && /^[0-9a-f-]{36}$/i.test(user.id)) map.set(email, user.id);
  }
  return map;
}

function dockerExecCapture(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { cwd: process.cwd() });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve(out) : reject(new Error(`docker ${args.join(" ")} exited ${code}`))));
  });
}

function startVite(anonKey) {
  const env = {
    ...process.env,
    VITE_E2E: "true",
    VITE_AISHA_GATEWAY_URL: GATEWAY_URL,
    VITE_AISHA_GATEWAY_KEY: anonKey,
    VITE_AISHA_POSTGREST_URL: GATEWAY_URL,
    VITE_AISHA_POSTGREST_ANON_KEY: anonKey,
    VITE_AISHA_POSTGREST_PUBLISHABLE_KEY: anonKey,
    VITE_KC_URL: KC_URL,
    VITE_KC_AUTHORITY: KC_AUTHORITY,
    VITE_KC_CLIENT_ID: KC_CLIENT_ID,
  };
  const child = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", WEB_PORT, "--strictPort"], {
    cwd: process.cwd(),
    stdio: "inherit",
    env,
  });
  return child;
}

async function main() {
  let vite;
  try {
    await ensureStackUp();
    if (!(await waitForHttp(`${KC_URL}/health/ready`, { attempts: 60 }))) {
      throw new Error(`Keycloak not ready at ${KC_URL}`);
    }
    await provisionUsers();
    const anonKey = await fetchAnonKey();

    console.log(`[devstack] starting vite (VITE_E2E) at ${WEB_ORIGIN} → gateway ${GATEWAY_URL}, KC ${KC_AUTHORITY}`);
    vite = startVite(anonKey);
    if (!(await waitForHttp(WEB_ORIGIN, { attempts: 60, ok: (r) => r.status < 500 }))) {
      throw new Error(`vite did not come up at ${WEB_ORIGIN}`);
    }

    console.log(`[devstack] running Playwright: ${PLAYWRIGHT_ARGS.join(" ") || "(all specs)"}`);
    await run("npx", ["playwright", "test", ...PLAYWRIGHT_ARGS], "playwright test", {
      env: {
        ...process.env,
        E2E_BASE_URL: WEB_ORIGIN,
        E2E_SKIP_SERVER: "1",
        E2E_KC_URL: KC_URL,
        E2E_KC_AUTHORITY: KC_AUTHORITY,
        E2E_KC_CLIENT_ID: KC_CLIENT_ID,
        E2E_ADMIN_EMAIL: process.env.E2E_ADMIN_EMAIL ?? "admin@platform.rtn",
        E2E_ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD ?? "Admin123!",
        VITE_AISHA_POSTGREST_URL: GATEWAY_URL,
        VITE_AISHA_GATEWAY_URL: GATEWAY_URL,
        VITE_AISHA_POSTGREST_ANON_KEY: anonKey,
        VITE_AISHA_GATEWAY_KEY: anonKey,
      },
    });
  } finally {
    if (vite && !vite.killed) vite.kill("SIGTERM");
  }
}

main().catch((e) => {
  console.error(`[devstack] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
