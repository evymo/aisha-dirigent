#!/usr/bin/env node
// deploy-oauth-coolify.mjs — Sets Apple/Google OAuth env vars in Coolify.
//
// Reads ALL credentials from environment (or .env-prod-backup via the
// caller's sourcing pattern, e.g. `set -a; source .env-prod-backup`).
// Nothing is committed to the repo.
//
// Usage:
//   set -a && source .env-prod-backup && set +a
//   node scripts/deploy-oauth-coolify.mjs
//
// Required env:
//   COOLIFY_API_TOKEN          — Coolify management API token
//   OAUTH_APPLE_CLIENT_ID      — Apple Services ID (e.g. cz.id3a.aisha)
//   OAUTH_APPLE_CLIENT_SECRET  — Apple ES256-signed JWT (gen-apple-secret.mjs)
// Optional env:
//   OAUTH_GOOGLE_CLIENT_ID + OAUTH_GOOGLE_CLIENT_SECRET (skipped if unset)
//   COOLIFY_HOST               — Coolify base host (e.g. frontend.example.com)

import { readFileSync } from "fs";
import https from "https";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    process.stderr.write(`[deploy-oauth-coolify] FATAL: env ${name} is required (load from .env-prod-backup)\n`);
    process.exit(2);
  }
  return v;
}

const TOKEN = requireEnv("COOLIFY_API_TOKEN");
const BASE_HOST = requireEnv("COOLIFY_HOST");
const APPLE_SECRET = requireEnv("OAUTH_APPLE_CLIENT_SECRET");
const APPLE_CLIENT_ID = requireEnv("OAUTH_APPLE_CLIENT_ID");
const GOOGLE_CLIENT_ID = process.env.OAUTH_GOOGLE_CLIENT_ID ?? "";
const GOOGLE_CLIENT_SECRET = process.env.OAUTH_GOOGLE_CLIENT_SECRET ?? "";

// UUID pairs from operator's Coolify env (each named OAUTH_DEPLOY_*_UUID).
// Operator discovers UUIDs once (GET /api/v1/applications/<app>/envs) and
// stores in .env-prod-backup. Two UUIDs per OAuth env-key because the
// auth service is deployed twice (prod + preview).
function uuidFromEnv(name) {
  const v = process.env[name];
  if (!v) {
    process.stderr.write(`FATAL: ${name} required (set in .env-prod-backup)\n`);
    process.exit(2);
  }
  return v;
}

const UPDATES = [
  // Apple — 2 deployment instances per env key
  { uuid: uuidFromEnv("OAUTH_DEPLOY_APPLE_CLIENT_ID_UUID_A"), key: "OAUTH_APPLE_CLIENT_ID",     value: APPLE_CLIENT_ID },
  { uuid: uuidFromEnv("OAUTH_DEPLOY_APPLE_CLIENT_ID_UUID_B"), key: "OAUTH_APPLE_CLIENT_ID",     value: APPLE_CLIENT_ID },
  { uuid: uuidFromEnv("OAUTH_DEPLOY_APPLE_CLIENT_SECRET_UUID_A"), key: "OAUTH_APPLE_CLIENT_SECRET",  value: APPLE_SECRET },
  { uuid: uuidFromEnv("OAUTH_DEPLOY_APPLE_CLIENT_SECRET_UUID_B"), key: "OAUTH_APPLE_CLIENT_SECRET",  value: APPLE_SECRET },
  // Google (only if credentials provided)
  ...(GOOGLE_CLIENT_ID ? [
    { uuid: uuidFromEnv("OAUTH_DEPLOY_GOOGLE_CLIENT_ID_UUID_A"), key: "OAUTH_GOOGLE_CLIENT_ID",     value: GOOGLE_CLIENT_ID },
    { uuid: uuidFromEnv("OAUTH_DEPLOY_GOOGLE_CLIENT_ID_UUID_B"), key: "OAUTH_GOOGLE_CLIENT_ID",     value: GOOGLE_CLIENT_ID },
    { uuid: uuidFromEnv("OAUTH_DEPLOY_GOOGLE_CLIENT_SECRET_UUID_A"), key: "OAUTH_GOOGLE_CLIENT_SECRET", value: GOOGLE_CLIENT_SECRET },
    { uuid: uuidFromEnv("OAUTH_DEPLOY_GOOGLE_CLIENT_SECRET_UUID_B"), key: "OAUTH_GOOGLE_CLIENT_SECRET", value: GOOGLE_CLIENT_SECRET },
  ] : []),
];

function patch(uuid, value) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ value });
    const req = https.request({
      hostname: BASE_HOST,
      path: `/api/v1/envs/${uuid}`,
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function redeploy(uuid) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: BASE_HOST,
      path: `/api/v1/deploy?uuid=${uuid}&force=true`,
      method: "GET",
      headers: { "Authorization": `Bearer ${TOKEN}` },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.end();
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────
console.log(`Setting ${UPDATES.length} env var(s) in Coolify...\n`);

let allOk = true;
for (const { uuid, key, value } of UPDATES) {
  const r = await patch(uuid, value);
  const ok = r.status === 200 || r.body.includes("updated");
  const disp = value.length > 30 ? value.slice(0, 12) + "…" : value;
  console.log(`  ${ok ? "✅" : "❌"} ${key} (${uuid.slice(0, 8)}…) = ${disp}`);
  if (!ok) {
    console.log(`     -> HTTP ${r.status}: ${r.body.slice(0, 120)}`);
    allOk = false;
  }
}

if (!GOOGLE_CLIENT_ID) {
  console.log("\n⚠️  Google credentials not set — skipping. Set OAUTH_GOOGLE_CLIENT_ID env var to include.");
}

if (allOk) {
  console.log("\nTriggering redeploy of core stack…");
  const redeployUuid = uuidFromEnv("OAUTH_DEPLOY_REDEPLOY_APP_UUID");
  const r = await redeploy(redeployUuid);
  console.log(`  Deploy response: HTTP ${r.status}`);
  console.log("  ✅ Done! Auth service will restart with new credentials.");
} else {
  console.log("\n❌ Some updates failed — skipping redeploy.");
}
