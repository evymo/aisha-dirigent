#!/usr/bin/env node
/**
 * provision-e2e-prod.mjs — Provision E2E test users on production Keycloak.
 *
 * Idempotent: safe to re-run. Creates 4 test users (admin/staff/member/partner)
 * with strong RANDOM passwords (not hardcoded "Admin123!" like local seed).
 * Persists generated passwords to .env-prod-backup so subsequent E2E runs
 * (and CI) can authenticate.
 *
 * Why these accounts on production:
 *   - Verifying that the deployed platform works end-to-end requires
 *     authenticated flows (admin section, member portal, RPC endpoints).
 *   - Lower-risk than using real user credentials.
 *   - Strong random passwords (32 chars) limit blast radius if leaked.
 *   - Accounts are clearly marked as E2E (e2e-* email prefix optional —
 *     keeping @platform.rtn for compatibility with existing fixtures).
 *
 * What it does:
 *   1. Reads KEYCLOAK_ADMIN_PASSWORD from .env.coolify (the cold-start-generated
 *      master admin password).
 *   2. Reads E2E_*_PASSWORD from .env-prod-backup if previously generated;
 *      otherwise generates new strong random ones.
 *   3. Authenticates to ${KEYCLOAK_URL} as master admin.
 *   4. Ensures `aisha-app` client has directAccessGrantsEnabled (ROPC) — the
 *      production realm import already has this, but defensive.
 *   5. Creates 4 users via partialImport (idempotent — uses ifResourceExists:
 *      OVERWRITE so password gets refreshed if rotation is desired).
 *   6. Persists newly generated passwords to .env-prod-backup.
 *
 * Run:
 *   node scripts/keycloak/provision-e2e-prod.mjs            # provision + persist
 *   node scripts/keycloak/provision-e2e-prod.mjs --rotate   # force regenerate passwords
 *   node scripts/keycloak/provision-e2e-prod.mjs --dry-run  # show plan, no API calls
 *   node scripts/keycloak/provision-e2e-prod.mjs --cleanup  # DELETE all e2e_user accounts
 *                                                           # (mass-delete via attribute filter)
 *
 * Output: env vars for run-against-production.sh:
 *   E2E_ADMIN_PASSWORD, E2E_MEMBER_PASSWORD, E2E_PARTNER_PASSWORD, E2E_STAFF_PASSWORD
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

const ENV_COOLIFY = resolve(ROOT, ".env.coolify");
const ENV_PROD_BACKUP = resolve(ROOT, ".env-prod-backup");
const KC_URL = process.env.KEYCLOAK_URL;
if (!KC_URL) {
  console.error("ERROR: KEYCLOAK_URL not set");
  process.exit(1);
}
const KC_REALM = process.env.KEYCLOAK_REALM ?? "aisha";
const KC_APP_CLIENT_ID = "aisha-app";

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const FORCE_ROTATE = argv.includes("--rotate");
const CLEANUP = argv.includes("--cleanup");

// ── Helpers ───────────────────────────────────────────────────────────────────
const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  blue: (s) => `\x1b[34m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};
const ok = (s) => console.log(`  ${C.green("✓")} ${s}`);
const info = (s) => console.log(`  ${C.blue("ℹ")} ${s}`);
const warn = (s) => console.log(`  ${C.yellow("⚠")} ${s}`);
const err = (s) => console.error(`  ${C.red("✗")} ${s}`);

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

function generatePassword() {
  // 32 chars: base64url alphabet (URL-safe, no special chars that break shell quoting)
  return randomBytes(24).toString("base64url");
}

// ── Read current state ────────────────────────────────────────────────────────
const coolifyEnv = readEnvFile(ENV_COOLIFY);
const prodEnv = readEnvFile(ENV_PROD_BACKUP);

const KC_ADMIN_USER = coolifyEnv.KEYCLOAK_ADMIN ?? "admin";
const KC_ADMIN_PASS = coolifyEnv.KEYCLOAK_ADMIN_PASSWORD;
if (!KC_ADMIN_PASS) {
  err(`KEYCLOAK_ADMIN_PASSWORD not found in ${ENV_COOLIFY}`);
  process.exit(1);
}

// E2E user passwords — preserve_or_gen pattern
const users = [
  {
    id: "e2e00000-0000-0000-0000-000000000001",
    username: "admin@platform.rtn",
    email: "admin@platform.rtn",
    firstName: "E2E",
    lastName: "Admin",
    realmRoles: ["admin", "staff", "member", "studio_access", "n8n_access"],
    envKey: "E2E_ADMIN_PASSWORD",
  },
  {
    id: "e2e00000-0000-0000-0000-000000000002",
    username: "member@platform.rtn",
    email: "member@platform.rtn",
    firstName: "E2E",
    lastName: "Member",
    realmRoles: ["member"],
    envKey: "E2E_MEMBER_PASSWORD",
  },
  {
    id: "e2e00000-0000-0000-0000-000000000003",
    username: "partner@platform.rtn",
    email: "partner@platform.rtn",
    firstName: "E2E",
    lastName: "Partner",
    realmRoles: ["practitioner", "member"],
    envKey: "E2E_PARTNER_PASSWORD",
  },
  {
    id: "e2e00000-0000-0000-0000-000000000004",
    username: "staff@platform.rtn",
    email: "staff@platform.rtn",
    firstName: "E2E",
    lastName: "Staff",
    realmRoles: ["staff", "member", "studio_access"],
    envKey: "E2E_STAFF_PASSWORD",
  },
];

// Resolve passwords (preserve existing unless --rotate)
const generatedNow = [];
for (const u of users) {
  const existing = prodEnv[u.envKey];
  if (existing && !FORCE_ROTATE) {
    u.password = existing;
  } else {
    u.password = generatePassword();
    generatedNow.push(u.envKey);
  }
}

console.log("\n🔐 Production Keycloak E2E user provisioning");
info(`KC server:  ${KC_URL}`);
info(`Realm:      ${KC_REALM}`);
info(`Admin:      ${KC_ADMIN_USER}`);
console.log();
for (const u of users) {
  const tag = generatedNow.includes(u.envKey) ? C.green("NEW") : C.dim("preserved");
  info(`${u.username.padEnd(28)} pw: ${u.envKey.padEnd(22)} ${tag}`);
}

if (DRY_RUN) {
  console.log("\n  (dry-run — no API calls or file writes)");
  process.exit(0);
}

// ── KC Admin REST API ────────────────────────────────────────────────────────
async function kcFetch(path, opts = {}) {
  const res = await fetch(`${KC_URL}${path}`, {
    ...opts,
    headers: {
      Accept: "application/json",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(opts.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  return res;
}

console.log("\n🔑 Authenticating as master admin...");
const tokenRes = await kcFetch(`/realms/master/protocol/openid-connect/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "password",
    client_id: "admin-cli",
    username: KC_ADMIN_USER,
    password: KC_ADMIN_PASS,
  }),
});
if (!tokenRes.ok) {
  err(`Master admin login failed: ${tokenRes.status} ${await tokenRes.text()}`);
  process.exit(1);
}
const { access_token } = await tokenRes.json();
ok("Master admin token acquired");

const ADMIN_API = `/admin/realms/${KC_REALM}`;
const HEAD = { Authorization: `Bearer ${access_token}` };

// ── Cleanup mode: delete all users with e2e_user attribute ──────────────────
if (CLEANUP) {
  console.log("\n🗑  Cleanup mode — deleting all e2e_user-tagged users...");

  // KC Admin API supports user search by attribute via `q` parameter (>=15)
  // Format: `q=key:value`. Falls back to listing all users if attribute
  // search isn't supported.
  let usersToDelete = [];
  const byAttrRes = await kcFetch(
    `${ADMIN_API}/users?q=e2e_user:true&max=100`,
    { headers: HEAD },
  );
  if (byAttrRes.ok) {
    usersToDelete = await byAttrRes.json();
  }

  if (usersToDelete.length === 0) {
    // Fallback: list all and filter by attribute (older KC versions)
    info("Attribute search returned 0 — falling back to full scan");
    const allRes = await kcFetch(`${ADMIN_API}/users?max=500&briefRepresentation=false`, {
      headers: HEAD,
    });
    if (allRes.ok) {
      const all = await allRes.json();
      usersToDelete = all.filter((u) => u.attributes?.e2e_user?.[0] === "true");
    }
  }

  // Also include the well-known E2E IDs (in case attribute is missing)
  const knownIds = new Set([
    "e2e00000-0000-0000-0000-000000000001",
    "e2e00000-0000-0000-0000-000000000002",
    "e2e00000-0000-0000-0000-000000000003",
    "e2e00000-0000-0000-0000-000000000004",
  ]);
  for (const id of knownIds) {
    if (!usersToDelete.some((u) => u.id === id)) {
      const r = await kcFetch(`${ADMIN_API}/users/${id}`, { headers: HEAD });
      if (r.ok) usersToDelete.push(await r.json());
    }
  }

  info(`Found ${usersToDelete.length} E2E users to delete`);
  for (const u of usersToDelete) {
    info(`  - ${u.username} (${u.id})`);
  }

  if (usersToDelete.length === 0) {
    ok("Nothing to clean up.");
    process.exit(0);
  }

  let deleted = 0;
  let failed = 0;
  for (const u of usersToDelete) {
    const delRes = await kcFetch(`${ADMIN_API}/users/${u.id}`, {
      method: "DELETE",
      headers: HEAD,
    });
    if (delRes.ok || delRes.status === 204) {
      deleted++;
    } else {
      failed++;
      err(`  Failed to delete ${u.username}: ${delRes.status}`);
    }
  }
  ok(`Deleted ${deleted} users (${failed} failures)`);

  // Remove the E2E block from .env-prod-backup
  if (existsSync(ENV_PROD_BACKUP)) {
    let backup = readFileSync(ENV_PROD_BACKUP, "utf8");
    const blockMarker = "# ── E2E test users (production Keycloak) ─────────────────────";
    const blockEnd = "# ── /E2E test users ──";
    const blockRegex = new RegExp(
      `${blockMarker.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}[\\s\\S]*?${blockEnd.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\n?`,
      "g",
    );
    const cleaned = backup.replace(blockRegex, "");
    if (cleaned !== backup) {
      writeFileSync(ENV_PROD_BACKUP, cleaned, { mode: 0o600 });
      ok("Removed E2E block from .env-prod-backup");
    }
  }

  console.log(`\n${C.green("✅ Cleanup done.")}\n`);
  process.exit(0);
}

// ── Ensure aisha-app client has ROPC enabled ───────────────────────────────
console.log("\n🔧 Ensuring aisha-app client has ROPC (directAccessGrantsEnabled)...");
const clientsRes = await kcFetch(`${ADMIN_API}/clients?clientId=${KC_APP_CLIENT_ID}`, {
  headers: HEAD,
});
const clients = await clientsRes.json();
if (!Array.isArray(clients) || clients.length === 0) {
  err(`Client ${KC_APP_CLIENT_ID} not found in realm ${KC_REALM}`);
  process.exit(1);
}
const client = clients[0];
const clientUuid = client.id;
if (!client.directAccessGrantsEnabled) {
  const upd = await kcFetch(`${ADMIN_API}/clients/${clientUuid}`, {
    method: "PUT",
    headers: HEAD,
    body: JSON.stringify({ ...client, directAccessGrantsEnabled: true }),
  });
  if (!upd.ok) {
    err(`Failed to enable ROPC: ${upd.status} ${await upd.text()}`);
    process.exit(1);
  }
  ok(`Enabled directAccessGrantsEnabled on ${KC_APP_CLIENT_ID}`);
} else {
  ok(`${KC_APP_CLIENT_ID} already has ROPC enabled`);
}

// ── Provision users via partialImport ─────────────────────────────────────
console.log("\n👥 Provisioning E2E users via partialImport...");
const importBody = {
  ifResourceExists: "OVERWRITE",
  roles: {
    realm: [
      { name: "admin" },
      { name: "staff" },
      { name: "member" },
      { name: "practitioner" },
      { name: "studio_access" },
      { name: "n8n_access" },
    ],
  },
  users: users.map((u) => ({
    id: u.id,
    username: u.username,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    enabled: true,
    emailVerified: true,
    realmRoles: u.realmRoles,
    attributes: { e2e_user: ["true"] },
    credentials: [{ type: "password", value: u.password, temporary: false }],
  })),
};

const importRes = await kcFetch(`${ADMIN_API}/partialImport`, {
  method: "POST",
  headers: HEAD,
  body: JSON.stringify(importBody),
});
if (!importRes.ok) {
  err(`partialImport failed: ${importRes.status} ${await importRes.text()}`);
  process.exit(1);
}
const importResult = await importRes.json();
ok(
  `partialImport: ${importResult.added ?? 0} added, ${importResult.overwritten ?? 0} overwritten, ${importResult.skipped ?? 0} skipped`,
);

// ── Persist passwords to .env-prod-backup ─────────────────────────────────
console.log("\n💾 Persisting passwords to .env-prod-backup...");
let backup = existsSync(ENV_PROD_BACKUP) ? readFileSync(ENV_PROD_BACKUP, "utf8") : "";
const blockMarker = "# ── E2E test users (production Keycloak) ─────────────────────";
const blockEnd = "# ── /E2E test users ──";

// Remove existing block if present
const blockRegex = new RegExp(
  `${blockMarker.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}[\\s\\S]*?${blockEnd.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\n?`,
  "g",
);
backup = backup.replace(blockRegex, "");
if (!backup.endsWith("\n")) backup += "\n";

const block = [
  blockMarker,
  "# Auto-generated by scripts/keycloak/provision-e2e-prod.mjs",
  "# Strong random passwords; rotate via --rotate flag.",
  ...users.flatMap((u) => [
    `# ${u.username} → roles: ${u.realmRoles.join(", ")}`,
    `${u.envKey}=${u.password}`,
  ]),
  blockEnd,
  "",
].join("\n");

writeFileSync(ENV_PROD_BACKUP, backup + block, { mode: 0o600 });
ok(`Persisted ${users.length} passwords to ${ENV_PROD_BACKUP}`);

console.log(`\n${C.green("✅ Done.")} Run E2E with:`);
console.log(`  source <(grep ^E2E_ ${ENV_PROD_BACKUP} | sed 's/^/export /')`);
console.log(`  bash scripts/e2e/run-against-production.sh --auth\n`);
