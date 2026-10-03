#!/usr/bin/env node
/**
 * Story Sync Pull — replica-side transport for the story twin runtime.
 *
 * Runs ON THE REPLICA. Pulls a story bundle from the origin (guru) instance
 * and imports it into the local stack via PostgREST RPCs:
 *
 *   1. POST {origin}/rest/v1/rpc/export_story_bundle          (writes a bundle on origin)
 *   2. GET  {origin}/rest/v1/story_bundles?id=eq.{bundle_id}  (fetch portable manifest)
 *   3. POST {local}/rest/v1/rpc/bootstrap_story_replica       (--bootstrap only)
 *   4. POST {local}/rest/v1/rpc/import_story_bundle_from_manifest
 *   5. POST {local}/rest/v1/rpc/adopt_story_as_stack_default  (--adopt-default only)
 *
 * Usage:
 *   node scripts/db/story-sync-pull.mjs --story-id=<uuid> --origin-url=https://guru.example.com [options]
 *
 * Options:
 *   --story-id=<uuid>           Story to pull (required)
 *   --origin-url=<url>          Origin PostgREST base URL (or AISHA_SYNC_ORIGIN_URL)
 *   --origin-key=<jwt>          Origin API key — service key / anon JWT (or AISHA_SYNC_ORIGIN_KEY)
 *   --origin-token=<token>      Origin instance auth token (aisha_sync_…) — passed as
 *                               p_instance_token to export_story_bundle (scope sync:export).
 *                               HTTP layer still needs --origin-key (PostgREST JWT).
 *   --source-instance-id=<uuid> Origin instance id — passed as p_source_instance_id with --origin-token
 *   --local-url=<url>           Local PostgREST base URL (default: AISHA_POSTGREST_URL /
 *                               VITE_AISHA_POSTGREST_URL / http://127.0.0.1:3001)
 *   --local-key=<jwt>           Local API key (or AISHA_POSTGREST_SERVICE_KEY)
 *   --local-token=<token>       Local instance auth token — passed as p_instance_token to
 *                               import_story_bundle_from_manifest (scope sync:import).
 *                               HTTP layer still needs --local-key (PostgREST JWT).
 *   --target-instance-id=<uuid> Local replica instance id (default: taken from --bootstrap result)
 *   --bootstrap                 Create the local replica story + instance first (first pull)
 *   --adopt-default             Adopt the replica story as the stack-default story after import
 *                               (passes p_demote_existing=true — demotes the locally
 *                               bootstrapped "Stack default web" story)
 *   --dry-run                   Print the plan without any network calls (export WRITES on origin,
 *                               so dry-run performs no requests at all)
 *   --help                      Show this help
 *
 * Environment:
 *   AISHA_SYNC_ORIGIN_URL, AISHA_SYNC_ORIGIN_KEY, AISHA_SYNC_ORIGIN_TOKEN,
 *   AISHA_POSTGREST_URL / VITE_AISHA_POSTGREST_URL, AISHA_POSTGREST_SERVICE_KEY,
 *   AISHA_SYNC_LOCAL_TOKEN, AISHA_SYNC_TARGET_INSTANCE_ID
 *
 * Zero-dependency: Node >= 20 (global fetch). No hardcoded URLs or keys.
 *
 * @module
 */
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const FETCH_TIMEOUT_MS = 30_000;

/**
 * Lightweight .env loader — populates process.env for missing keys only.
 * Same pattern as scripts/ide-adapters/payload.mjs (no external dependency).
 */
function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!existsSync(envPath)) return;
  try {
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (/^[A-Z0-9_]+$/.test(key) && !process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch (err) {
    console.warn(`[story-sync-pull] .env load failed: ${err?.message || err}`);
  }
}

loadEnvFile();

/** Parse --key=value, --key value, and boolean --flag arguments. */
function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eqIdx = arg.indexOf("=");
    if (eqIdx > 2) {
      flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
    } else {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

function printHelp() {
  const header = readFileSync(fileURLToPath(import.meta.url), "utf-8")
    .split("\n")
    .filter((l) => l.startsWith(" *"))
    .map((l) => l.replace(/^ \*( |$)/, ""))
    .join("\n");
  console.log(header);
}

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function stripTrailingSlash(url) {
  return url.replace(/\/+$/, "");
}

function redact(value) {
  if (!value) return "(not set)";
  return value.length > 10 ? `${value.slice(0, 6)}…(redacted)` : "***";
}

/**
 * Call a PostgREST endpoint. Throws a readable Error on non-2xx responses.
 * @param {object} opts
 * @param {string} opts.url  Full endpoint URL
 * @param {string} opts.key  API key for apikey + Authorization Bearer headers
 * @param {string} [opts.method]
 * @param {object} [opts.body]
 * @param {string} [opts.label] Human-readable step label for error messages
 */
async function callPostgrest({ url, key, method = "POST", body, label }) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`${label}: network error calling ${url} — ${err?.message || err}`);
  }

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON error body — keep raw text for the message below.
  }

  if (!response.ok) {
    const detail =
      parsed && typeof parsed === "object"
        ? [parsed.message, parsed.details, parsed.hint].filter(Boolean).join(" | ")
        : text.slice(0, 500);
    throw new Error(`${label}: HTTP ${response.status} from ${url}${detail ? ` — ${detail}` : ""}`);
  }

  return parsed;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.help) {
    printHelp();
    return;
  }

  // ── Resolve configuration (args > env > defaults; no hardcoded secrets) ──
  const storyId = flags["story-id"];
  const originUrlRaw = flags["origin-url"] || process.env.AISHA_SYNC_ORIGIN_URL;
  const originKey = flags["origin-key"] || process.env.AISHA_SYNC_ORIGIN_KEY;
  const originToken = flags["origin-token"] || process.env.AISHA_SYNC_ORIGIN_TOKEN;
  const sourceInstanceId = flags["source-instance-id"] || process.env.AISHA_SYNC_SOURCE_INSTANCE_ID;
  const localUrlRaw =
    flags["local-url"] ||
    process.env.AISHA_POSTGREST_URL ||
    process.env.VITE_AISHA_POSTGREST_URL ||
    "http://127.0.0.1:3001";
  const localKey = flags["local-key"] || process.env.AISHA_POSTGREST_SERVICE_KEY;
  const localToken = flags["local-token"] || process.env.AISHA_SYNC_LOCAL_TOKEN;
  let targetInstanceId = flags["target-instance-id"] || process.env.AISHA_SYNC_TARGET_INSTANCE_ID;
  const doBootstrap = flags.bootstrap === true;
  const doAdoptDefault = flags["adopt-default"] === true;
  const dryRun = flags["dry-run"] === true;

  if (!storyId) fail("Missing --story-id (origin story UUID).");
  if (!originUrlRaw) fail("Missing --origin-url (or AISHA_SYNC_ORIGIN_URL).");
  if (!originKey) {
    fail(
      "Missing --origin-key (or AISHA_SYNC_ORIGIN_KEY). PostgREST needs a JWT for the HTTP layer;\n" +
        "   an instance token (--origin-token) authorizes the RPC, not the HTTP request.",
    );
  }
  if (!localKey) {
    fail(
      "Missing --local-key (or AISHA_POSTGREST_SERVICE_KEY). PostgREST needs a JWT for the HTTP layer;\n" +
        "   an instance token (--local-token) authorizes the RPC, not the HTTP request.",
    );
  }
  if (!doBootstrap && !targetInstanceId) {
    fail("Missing --target-instance-id (required unless --bootstrap creates the replica instance).");
  }

  const originUrl = stripTrailingSlash(originUrlRaw);
  const localUrl = stripTrailingSlash(localUrlRaw);

  const exportBody = { p_story_id: storyId };
  if (originToken) {
    exportBody.p_instance_token = originToken;
    if (sourceInstanceId) exportBody.p_source_instance_id = sourceInstanceId;
  }

  console.log(`\n🔄 Story Sync Pull — story ${storyId}`);
  console.log(`   origin: ${originUrl} (key: ${redact(originKey)}${originToken ? ", instance token" : ""})`);
  console.log(`   local:  ${localUrl} (key: ${redact(localKey)}${localToken ? ", instance token" : ""})`);
  console.log(
    `   options: bootstrap=${doBootstrap} adopt-default=${doAdoptDefault}` +
      (targetInstanceId ? ` target-instance=${targetInstanceId}` : "") +
      "\n",
  );

  // ── Dry run: print the plan, perform ZERO requests. ──
  // Even the export step writes on origin (new story_bundles row + sync operation),
  // so dry-run must not call anything — not even a "read-only looking" export.
  if (dryRun) {
    console.log("🧪 Dry run — no requests will be made. Plan:\n");
    let step = 1;
    console.log(
      `   ${step++}. POST ${originUrl}/rest/v1/rpc/export_story_bundle\n` +
        `      body: ${JSON.stringify({ ...exportBody, p_instance_token: originToken ? "***" : undefined })}`,
    );
    console.log(
      `   ${step++}. GET  ${originUrl}/rest/v1/story_bundles?id=eq.{bundle_id}&select=portable_manifest,schema_version`,
    );
    if (doBootstrap) {
      console.log(
        `   ${step++}. POST ${localUrl}/rest/v1/rpc/bootstrap_story_replica\n` +
          `      body: { p_manifest (from step 2), p_manifest_hash (from step 1) }`,
      );
    }
    console.log(
      `   ${step++}. POST ${localUrl}/rest/v1/rpc/import_story_bundle_from_manifest\n` +
        `      body: { p_manifest, p_bundle_version, p_manifest_hash, p_source_label: "origin"` +
        `${localToken ? ", p_instance_token: ***" : ""}, p_target_instance_id: ${targetInstanceId || "{from bootstrap}"} }`,
    );
    if (doAdoptDefault) {
      console.log(
        `   ${step++}. POST ${localUrl}/rest/v1/rpc/adopt_story_as_stack_default ` +
          `{ p_story_id, p_demote_existing: true }`,
      );
    }
    console.log("\n✅ Dry run complete. Re-run without --dry-run to execute.");
    return;
  }

  // ── Step 1: export bundle on origin ──
  console.log("📦 [1/5] Exporting bundle on origin…");
  const exportResult = await callPostgrest({
    url: `${originUrl}/rest/v1/rpc/export_story_bundle`,
    key: originKey,
    body: exportBody,
    label: "export_story_bundle (origin)",
  });
  const bundleId = exportResult?.bundle_id;
  const bundleVersion = exportResult?.bundle_version;
  const manifestHash = exportResult?.manifest_hash;
  if (!bundleId || bundleVersion === undefined || !manifestHash) {
    fail(`export_story_bundle returned an unexpected payload: ${JSON.stringify(exportResult).slice(0, 500)}`);
  }
  console.log(`   bundle_id=${bundleId} version=${bundleVersion} hash=${manifestHash.slice(0, 12)}…`);

  // ── Step 2: fetch the portable manifest from origin ──
  console.log("📥 [2/5] Fetching portable manifest from origin…");
  const bundleRows = await callPostgrest({
    url: `${originUrl}/rest/v1/story_bundles?id=eq.${encodeURIComponent(bundleId)}&select=portable_manifest,schema_version`,
    key: originKey,
    method: "GET",
    label: "story_bundles read from origin",
  });
  const bundleRow = Array.isArray(bundleRows) ? bundleRows[0] : null;
  if (!bundleRow?.portable_manifest) {
    fail(`Bundle ${bundleId} not readable from origin (empty result — check key permissions/RLS).`);
  }
  const manifest = bundleRow.portable_manifest;
  console.log(`   manifest schema_version=${manifest.schema_version || bundleRow.schema_version || "unknown"}`);

  // ── Step 3 (optional): bootstrap the replica story + instance locally ──
  if (doBootstrap) {
    console.log("🌱 [3/5] Bootstrapping local replica (bootstrap_story_replica)…");
    const bootstrapResult = await callPostgrest({
      url: `${localUrl}/rest/v1/rpc/bootstrap_story_replica`,
      key: localKey,
      body: { p_manifest: manifest, p_manifest_hash: manifestHash },
      label: "bootstrap_story_replica (local)",
    });
    console.log(`   ${JSON.stringify(bootstrapResult)}`);
    const bootstrappedInstanceId =
      bootstrapResult?.instance_id || bootstrapResult?.replica_instance_id || bootstrapResult?.target_instance_id;
    if (!targetInstanceId && bootstrappedInstanceId) {
      targetInstanceId = bootstrappedInstanceId;
      console.log(`   using bootstrapped replica instance: ${targetInstanceId}`);
    }
  } else {
    console.log("⏭️  [3/5] Bootstrap skipped (no --bootstrap).");
  }

  if (!targetInstanceId) {
    fail("No target instance id available (bootstrap did not return one and --target-instance-id not set).");
  }

  // ── Step 4: import the manifest locally ──
  console.log("📦 [4/5] Importing manifest into local replica…");
  const importBody = {
    p_manifest: manifest,
    p_bundle_version: bundleVersion,
    p_manifest_hash: manifestHash,
    p_source_label: "origin",
    p_target_instance_id: targetInstanceId,
  };
  if (localToken) importBody.p_instance_token = localToken;
  const importResult = await callPostgrest({
    url: `${localUrl}/rest/v1/rpc/import_story_bundle_from_manifest`,
    key: localKey,
    body: importBody,
    label: "import_story_bundle_from_manifest (local)",
  });
  console.log(`   ${JSON.stringify(importResult, null, 2)}`);
  const importStatus = importResult?.status;
  if (importStatus === "partial") {
    // Fingerprint mismatch: the locally recomputed ruleset fingerprint differs
    // from the manifest one (e.g. a shared rule was skipped). The import DID
    // apply — continue, but make the divergence impossible to miss.
    const fingerprintLines = Object.entries(importResult)
      .filter(([key]) => key.includes("fingerprint") && key !== "ruleset_fingerprint_verified")
      .map(([key, value]) => `║   ${key}: ${JSON.stringify(value)}`);
    console.warn(
      [
        "",
        "╔══════════════════════════════════════════════════════════════════╗",
        "║  ⚠️  WARNING: IMPORT COMPLETED ONLY PARTIALLY (status: partial)     ",
        "║                                                                    ",
        "║  The ruleset fingerprint recomputed on this replica does NOT       ",
        "║  match the manifest fingerprint from origin. The replica ruleset   ",
        "║  has DIVERGED from the origin bundle.                              ",
        "║                                                                    ",
        `║   ruleset_fingerprint_verified: ${JSON.stringify(importResult?.ruleset_fingerprint_verified ?? null)}`,
        ...fingerprintLines,
        "║                                                                    ",
        "║  Inspect story_sync_operations metadata (SYNC_FINGERPRINT_MISMATCH ",
        "║  in audit_journal) before trusting this replica's ruleset.         ",
        "╚══════════════════════════════════════════════════════════════════╝",
        "",
      ].join("\n"),
    );
  } else if (importStatus && !["success", "skipped"].includes(importStatus)) {
    fail(`Import did not succeed (status: ${importStatus} — ${importResult?.reason || "no reason given"}).`);
  }

  // ── Step 5 (optional): adopt as stack-default story ──
  if (doAdoptDefault) {
    console.log("🏠 [5/5] Adopting story as stack default (adopt_story_as_stack_default)…");
    // p_demote_existing: a fresh replica already holds the locally bootstrapped
    // "Stack default web" story (ensure_stack_default_story) — adopting the
    // replicated story must demote it, otherwise the singleton check fails.
    const adoptResult = await callPostgrest({
      url: `${localUrl}/rest/v1/rpc/adopt_story_as_stack_default`,
      key: localKey,
      body: { p_story_id: storyId, p_demote_existing: true },
      label: "adopt_story_as_stack_default (local)",
    });
    console.log(`   ${JSON.stringify(adoptResult)}`);
  } else {
    console.log("⏭️  [5/5] Stack-default adoption skipped (no --adopt-default).");
  }

  console.log("\n✅ Story sync pull complete.");
  console.log(`   story_id:        ${storyId}`);
  console.log(`   bundle_version:  ${bundleVersion}`);
  console.log(`   target_instance: ${targetInstanceId}`);
  console.log(`   import_status:   ${importStatus || "unknown"}`);
  console.log(
    `\n💡 HINT: point gen:ide at this story by writing .aisha/story.json:\n` +
      `   echo '{"story_id": "${storyId}"}' > .aisha/story.json\n` +
      `   then run: npm run gen:ide\n`,
  );
}

main().catch((err) => {
  console.error(`\n❌ ${err?.message || err}`);
  process.exit(1);
});
