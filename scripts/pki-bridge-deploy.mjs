#!/usr/bin/env node
/**
 * pki-bridge-deploy.mjs — Set OPENXPKI_RPC_HMAC env in Coolify + redeploy PKI stack
 *
 * Steps:
 *   1. Generate or read OPENXPKI_RPC_HMAC secret
 *   2. Find aisha-pki app UUID in Coolify
 *   3. PATCH env var via Coolify API (idempotent upsert)
 *   4. Trigger redeploy of aisha-pki
 *   5. Wait for healthy status
 *
 * Usage:
 *   node scripts/pki-bridge-deploy.mjs
 *   node scripts/pki-bridge-deploy.mjs --dry-run
 *   OPENXPKI_RPC_HMAC=<hex> node scripts/pki-bridge-deploy.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveInstancePrefix } from "./lib/coolify-instance-scope.mjs";
import { jeProkazatelneZdrava } from "./lib/coolify-app-status.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Which instance does this run act on?
 *
 * Derived from the env file that declares it — that file IS the instance — with
 * the ambient shell allowed only to concur. No default: on a shared Coolify an
 * unknown instance would mean writing into someone else's production, which is
 * exactly what happened on 2026-07-21.
 */
// Instance identity comes from the shared boundary (lib/coolify-instance-scope.mjs)
// — one place for every tool, never re-derived here.
const instancePrefix = () => resolveInstancePrefix();
const ENV_BACKUP = resolve(ROOT, ".env-prod-backup");
const ENV_COOLIFY = resolve(ROOT, ".env.coolify");
const COOLIFY_BASE = (() => {
  const v = process.env.COOLIFY_BASE_URL;
  if (!v) { process.stderr.write("FATAL: COOLIFY_BASE_URL required\n"); process.exit(2); }
  return v;
})();
const API_BASE = `${COOLIFY_BASE}/api/v1`;
const DRY_RUN = process.argv.includes("--dry-run");

// ── Token ────────────────────────────────────────────────────────────

function loadToken() {
  if (process.env.COOLIFY_API_TOKEN) return process.env.COOLIFY_API_TOKEN.replace(/^["']|["']$/g, "");
  if (process.env.COOLIFY_API_KEY) return process.env.COOLIFY_API_KEY.replace(/^["']|["']$/g, "");
  for (const envFile of [ENV_COOLIFY, ENV_BACKUP]) {
    if (!existsSync(envFile)) continue;
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = line.match(/^COOLIFY_API_(?:TOKEN|KEY)=(.+)$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  throw new Error("COOLIFY_API_TOKEN/KEY not found");
}

const TOKEN = loadToken();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const init = {
        method,
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
      };
      if (body) init.body = JSON.stringify(body);
      const r = await fetch(`${API_BASE}${path}`, init);
      const t = await r.text();
      if (!r.ok) throw new Error(`HTTP ${r.status} ${method} ${path}: ${t.slice(0, 200)}`);
      return t ? JSON.parse(t.replace(/[\x00-\x1f]/g, "")) : null;
    } catch (e) {
      if (attempt < 3) { await sleep(attempt * 2000); continue; }
      throw e;
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔧 pki-bridge-deploy — ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

  // Step 1: HMAC secret — execFileSync (no shell, safe)
  let hmac = process.env.OPENXPKI_RPC_HMAC;
  if (!hmac) {
    hmac = execFileSync("openssl", ["rand", "-hex", "32"], { encoding: "utf8" }).trim();
    console.log(`  Generated OPENXPKI_RPC_HMAC: ${hmac.slice(0, 8)}...${hmac.slice(-8)}`);
  } else {
    console.log(`  Using existing OPENXPKI_RPC_HMAC: ${hmac.slice(0, 8)}...${hmac.slice(-8)}`);
  }

  // Step 2: Find THIS instance's pki app.
  //
  // The name used to be the literal "aisha-pki". On a Coolify that hosts several
  // instances side by side (<prefix>-* …) that is not a name,
  // it is a different tenant's production app — and unlike a bad env var, no
  // configuration could make it right: running this from the RIQ worktree wrote
  // RIQ's PKI credentials into aisha-pki. The prefix is derived, and the log line
  // prints what was actually resolved, because a probe that says "aisha-pki"
  // whether targeting is correct or catastrophically wrong tells the operator
  // nothing.
  const prefix = instancePrefix();
  const pkiName = `${prefix}-pki`;
  console.log(`  Finding ${pkiName} in Coolify...`);
  const apps = await api("GET", "/applications");
  const matches = apps.filter((a) => a.name === pkiName);
  if (matches.length === 0) throw new Error(`${pkiName} not found in Coolify applications`);
  // Two apps of one name means the target is ambiguous; picking either is a guess.
  if (matches.length > 1) {
    throw new Error(`${matches.length} applications named ${pkiName} — refusing to guess which instance is meant`);
  }
  const pkiApp = matches[0];
  console.log(`  ✓ ${pkiName} UUID: ${pkiApp.uuid}`);

  // Step 3: Set env vars (HMAC + renewer credentials)
  console.log("  Setting PKI env vars...");

  // Load renewer credentials from .env.coolify if available
  const renewerEnvs = [];
  for (const envFile of [ENV_COOLIFY, ENV_BACKUP]) {
    if (!existsSync(envFile)) continue;
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      for (const key of ["AISHA_PKI_BOOTSTRAP_CLIENT_SECRET", "AISHA_PKI_BOOTSTRAP_PASSWORD"]) {
        const m = line.match(new RegExp(`^${key}=(.+)$`));
        if (m) renewerEnvs.push({ key, value: m[1].trim().replace(/^["']|["']$/g, "") });
      }
    }
    if (renewerEnvs.length >= 2) break;
  }

  const envData = [
    { key: "OPENXPKI_RPC_HMAC", value: hmac, is_preview: false, is_build_time: true, is_shown_once: false },
    ...renewerEnvs.map(({ key, value }) => ({ key, value, is_preview: false, is_build_time: false, is_shown_once: false })),
  ];

  if (!DRY_RUN) {
    await api("PATCH", `/applications/${pkiApp.uuid}/envs/bulk`, { data: envData });
    console.log(`  ✓ ${envData.length} env vars set in Coolify (HMAC + ${renewerEnvs.length} renewer creds)`);
  } else {
    console.log(`  [DRY RUN] Would set ${envData.length} env vars: ${envData.map((e) => e.key).join(", ")}`);
  }

  // Step 4: Trigger redeploy
  console.log("  Triggering aisha-pki redeploy...");
  if (!DRY_RUN) {
    const result = await api("POST", `/applications/${pkiApp.uuid}/restart`);
    console.log(`  ✓ Redeploy triggered: ${JSON.stringify(result ?? "queued")}`);
  } else {
    console.log("  [DRY RUN] Would trigger redeploy");
  }

  // Step 5: Wait for healthy (max 180s)
  if (!DRY_RUN) {
    console.log("  Waiting for aisha-pki healthy status (max 180s)...");
    for (let i = 0; i < 18; i++) {
      await sleep(10_000);
      try {
        const status = await api("GET", `/applications/${pkiApp.uuid}`);
        const s = status?.status ?? "unknown";
        process.stdout.write(`    [${(i + 1) * 10}s] ${s}\n`);
        // ⛔ NAMĚŘENO 2026-08-17: dřívější `s.includes("healthy")` ukončilo
        // čekání i na `exited:unhealthy` a vypsalo „✓ is healthy!" nad mrtvým
        // kontejnerem — `unhealthy` ten podřetězec obsahuje.
        if (jeProkazatelneZdrava(s)) {
          console.log("  ✓ aisha-pki is healthy!");
          break;
        }
      } catch {
        // Polling loop — transient fetch failure is expected during boot,
        // retry on next iteration without surfacing noise.
      }
    }
  }

  // Print the HMAC for reference
  console.log(`\n  📋 OPENXPKI_RPC_HMAC=${hmac}`);
  console.log("  Save this value — needed by pki-bridge and cert issuance scripts.\n");
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
