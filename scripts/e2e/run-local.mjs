import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolveKcEndpoints } from "../lib/kc-endpoint-resolver.mjs";

const PLAYWRIGHT_ARGS = process.argv.slice(2);
const LOCAL_AISHA_GATEWAY_URL =
  process.env.E2E_AISHA_GATEWAY_URL
  ?? process.env.E2E_GATEWAY_URL
  ?? `http://127.0.0.1:${process.env.E2E_GATEWAY_PORT ?? "3001"}`;
const LOCAL_KC_URL = process.env.E2E_KC_URL ?? `http://127.0.0.1:${process.env.E2E_KC_PORT ?? "8080"}`;
const LOCAL_KC_REALM = process.env.KEYCLOAK_REALM ?? "aisha";
const LOCAL_KC_AUTHORITY = process.env.E2E_KC_AUTHORITY ?? `${LOCAL_KC_URL.replace(/\/$/, "")}/realms/${LOCAL_KC_REALM}`;
const LOCAL_KC_CLIENT_ID = process.env.E2E_KC_CLIENT_ID ?? "aisha-app";
const LOCAL_AISHA_GATEWAY_KEY =
  process.env.VITE_AISHA_GATEWAY_KEY ??
  process.env.VITE_AISHA_POSTGREST_PUBLISHABLE_KEY ?? "";

// Same shared resolver the local-warmup generator uses: decouple the host-facing
// issuer (the loopback the browser / iOS-sim reaches, which the gateway string-
// compares against token.iss to MINT) from the in-network JWKS/token fetch
// (aisha-keycloak:80 via docker DNS). docker-compose.e2e.yml references the
// ${KC_ISSUER}/${KC_JWKS_URL}/${KC_TOKEN_URL}/${KC_HOSTNAME} injected below.
const KC_ENDPOINTS = resolveKcEndpoints({
  hostFacingHost: process.env.E2E_KC_HOST ?? "127.0.0.1",
  hostFacingPort: process.env.E2E_KC_PORT ?? "8080",
  hostFacingScheme: "http",
  inNetworkHost: "aisha-keycloak",
  inNetworkPort: "80",
  inNetworkScheme: "http",
  realm: LOCAL_KC_REALM,
});

const env = {
  ...process.env,
  VITE_E2E: "true",
  VITE_AISHA_GATEWAY_URL: LOCAL_AISHA_GATEWAY_URL,
  VITE_AISHA_GATEWAY_KEY: LOCAL_AISHA_GATEWAY_KEY,
  VITE_AISHA_POSTGREST_URL: LOCAL_AISHA_GATEWAY_URL,
  VITE_AISHA_POSTGREST_ANON_KEY: LOCAL_AISHA_GATEWAY_KEY,
  VITE_AISHA_POSTGREST_PUBLISHABLE_KEY: LOCAL_AISHA_GATEWAY_KEY,
  E2E_KC_URL: LOCAL_KC_URL,
  E2E_KC_AUTHORITY: LOCAL_KC_AUTHORITY,
  E2E_KC_CLIENT_ID: LOCAL_KC_CLIENT_ID,
  VITE_KC_URL: LOCAL_KC_URL,
  VITE_KC_AUTHORITY: LOCAL_KC_AUTHORITY,
  VITE_KC_CLIENT_ID: LOCAL_KC_CLIENT_ID,
  NETBIRD_MGMT_HOST: process.env.NETBIRD_MGMT_HOST ?? "127.0.0.1",
  // Host-facing issuer ⟂ in-network JWKS/token (consumed by docker-compose.e2e.yml).
  KC_ISSUER: KC_ENDPOINTS.issuer,
  KC_JWKS_URL: KC_ENDPOINTS.inNetworkJwks,
  KC_TOKEN_URL: KC_ENDPOINTS.inNetworkToken,
  KC_HOSTNAME: KC_ENDPOINTS.hostFacingBase,
};

const COMPOSE_ARGS = [
  "--env-file",
  ".env.coolify",
  "-f",
  "docker-compose.coolify.yml",
  "-f",
  "docker-compose.coolify-keycloak.yml",
  "-f",
  "docker-compose.e2e.yml",
];
const COMPOSE_UP_ARGS = process.env.E2E_SKIP_BUILD === "1"
  ? ["up", "-d"]
  : ["up", "-d", "--build"];

function keycloakExecEnvArgs() {
  const args = [];
  if (env.KC_ADMIN_USER) args.push("-e", "KC_ADMIN_USER");
  if (env.KC_ADMIN_PASS) args.push("-e", "KC_ADMIN_PASS");
  return args;
}

function run(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: "inherit",
      env,
    });

    child.on("error", (error) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${label} failed with exit code ${code ?? 1}`));
    });
  });
}

function runWithInput(command, args, input, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["pipe", "inherit", "inherit"],
      env,
    });

    child.on("error", (error) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${label} failed with exit code ${code ?? 1}`));
    });

    child.stdin.end(input);
  });
}

function startBackground(command, args, label) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env,
  });

  child.on("error", (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[e2e] ${label} crashed: ${message}`);
  });

  return child;
}

function stopBackground(child) {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
}

async function runOptional(command, args, label) {
  try {
    await run(command, args, label);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[e2e] ${label} failed, continuing with existing local state: ${message}`);
  }
}

async function waitForHttp(url, options = {}) {
  const {
    attempts = 60,
    delayMs = 2_000,
    headers,
    ok = (response) => response.ok,
  } = options;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(url, {
        headers,
        signal: controller.signal,
      });

      if (ok(response)) {
        return;
      }
    } catch {
      // Retry until attempts exhausted.
    } finally {
      clearTimeout(timeout);
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.E2E_HTTP_TIMEOUT_MS ?? 15_000));
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function keycloakAdminCredentials() {
  const username = env.KC_ADMIN_USER ?? env.KEYCLOAK_ADMIN;
  const password = env.KC_ADMIN_PASS ?? env.KEYCLOAK_ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error("Missing KC_ADMIN_USER/KC_ADMIN_PASS or KEYCLOAK_ADMIN/KEYCLOAK_ADMIN_PASSWORD for E2E Keycloak sync");
  }
  return { username, password };
}

async function getKeycloakAdminToken() {
  const { username, password } = keycloakAdminCredentials();
  const response = await fetchWithTimeout(`${LOCAL_KC_URL}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username,
      password,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Keycloak admin token request failed: ${response.status} ${body.slice(0, 240)}`);
  }

  const json = await response.json();
  if (!json || typeof json.access_token !== "string" || json.access_token.length === 0) {
    throw new Error("Keycloak admin token response did not include access_token");
  }
  return json.access_token;
}

async function getKeycloakUserIds(emails) {
  const token = await getKeycloakAdminToken();
  const entries = await Promise.all(emails.map(async (email) => {
    const params = new URLSearchParams({
      username: email,
      exact: "true",
      briefRepresentation: "true",
      max: "5",
    });
    const response = await fetchWithTimeout(`${LOCAL_KC_URL}/admin/realms/${LOCAL_KC_REALM}/users?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Could not resolve Keycloak user id for ${email}: ${response.status} ${body.slice(0, 240)}`);
    }

    const users = await response.json();
    if (!Array.isArray(users)) {
      throw new Error(`Could not resolve Keycloak user id for ${email}; admin API returned non-array response`);
    }

    const user = users.find((candidate) => candidate && candidate.username === email);
    const id = user?.id;
    if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) {
      throw new Error(`Could not resolve Keycloak user id for ${email}; got ${JSON.stringify(users)}`);
    }
    return [email, id];
  }));

  return new Map(entries);
}

async function applyE2ESeed() {
  const sql = readFileSync("aisha/db/seed.e2e.sql", "utf8");
  await runWithInput(
    "docker",
    ["compose", ...COMPOSE_ARGS, "exec", "-T", "db", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
    sql,
    "apply deterministic e2e seed",
  );
}

async function syncE2EIdentityMappings() {
  const users = [
    ["e2e00000-0000-0000-0000-000000000001", "admin@platform.rtn"],
    ["e2e00000-0000-0000-0000-000000000002", "member@platform.rtn"],
    ["e2e00000-0000-0000-0000-000000000003", "partner@platform.rtn"],
    ["e2e00000-0000-0000-0000-000000000004", "staff@platform.rtn"],
  ];
  const values = [];
  const keycloakUserIds = await getKeycloakUserIds(users.map(([, email]) => email));

  for (const [appUserId, email] of users) {
    const keycloakUserId = keycloakUserIds.get(email);
    values.push(`(${sqlLiteral(appUserId)}::uuid, ${sqlLiteral(email)}, ${sqlLiteral(keycloakUserId)})`);
  }

  const sql = `
WITH e2e_users(user_id, email, provider_id) AS (
  VALUES ${values.join(",\n         ")}
)
DELETE FROM aisha_auth.identities i
USING e2e_users e
WHERE i.provider = 'keycloak'
  AND i.email = e.email;

WITH e2e_users(user_id, email, provider_id) AS (
  VALUES ${values.join(",\n         ")}
)
INSERT INTO aisha_auth.identities (user_id, provider, provider_id, email, identity_data, updated_at, last_sign_in_at)
SELECT
  e.user_id,
  'keycloak',
  e.provider_id,
  e.email,
  jsonb_build_object('sub', e.provider_id, 'email', e.email, 'app_user_id', e.user_id),
  now(),
  now()
FROM e2e_users e
ON CONFLICT (provider, provider_id) DO UPDATE
SET user_id = EXCLUDED.user_id,
    email = EXCLUDED.email,
    identity_data = EXCLUDED.identity_data,
    updated_at = now(),
    last_sign_in_at = now();
`;

  await run(
    "docker",
    ["compose", ...COMPOSE_ARGS, "exec", "-T", "db", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", sql],
    "sync e2e keycloak identity mappings",
  );
}

async function main() {
  let functionsServe;

  try {
    console.log("[e2e] Starting local PSQL/PostgREST/Keycloak/Gateway stack...");
    await runOptional("docker", ["network", "create", "coolify"], "docker network create coolify");
    await run(
      "docker",
      ["compose", ...COMPOSE_ARGS, ...COMPOSE_UP_ARGS, "db", "postgrest", "migrate", "keycloak", "gateway", "svc-mcp-knowledge"],
      "docker compose up core e2e stack",
    );
    // Edge functions are routed through the Gateway /functions/v1 facade.
    functionsServe = null;

    console.log("[e2e] Applying deterministic E2E database seed...");
    await applyE2ESeed();
    console.log(`[e2e] Waiting for Keycloak at ${LOCAL_KC_URL}...`);
    await waitForHttp(`${LOCAL_KC_URL}/health/ready`, {
      attempts: Number(process.env.E2E_KC_READY_ATTEMPTS ?? 360),
      ok: (response) => response.ok,
    });
    if (process.env.E2E_SKIP_KC_PROVISION === "1") {
      console.log("[e2e] Skipping Keycloak E2E provisioning (E2E_SKIP_KC_PROVISION=1).");
    } else {
      console.log("[e2e] Provisioning Keycloak E2E client and users...");
      await run(
        "docker",
        ["compose", ...COMPOSE_ARGS, "exec", "-T", ...keycloakExecEnvArgs(), "keycloak", "bash", "/opt/keycloak/provision-e2e.sh"],
        "keycloak e2e provisioning",
      );
    }
    if (process.env.E2E_SKIP_KC_SYNC === "1") {
      console.log("[e2e] Skipping Keycloak identity sync (E2E_SKIP_KC_SYNC=1).");
    } else {
      console.log("[e2e] Syncing Keycloak subject mappings into PSQL...");
      await syncE2EIdentityMappings();
    }
    console.log(`[e2e] Waiting for Gateway at ${LOCAL_AISHA_GATEWAY_URL}...`);
    await waitForHttp(`${LOCAL_AISHA_GATEWAY_URL}/health`, {
      ok: (response) => response.ok,
    });
    console.log("[e2e] Waiting for MCP Knowledge through Gateway...");
    await waitForHttp(`${LOCAL_AISHA_GATEWAY_URL}/functions/v1/mcp-knowledge-server`, {
      ok: (response) => response.status < 500,
    });

    console.log(`[e2e] Running Playwright: npx playwright test ${PLAYWRIGHT_ARGS.join(" ")}`.trim());
    await run("npx", ["playwright", "test", ...PLAYWRIGHT_ARGS], "playwright test");
  } finally {
    stopBackground(functionsServe);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
