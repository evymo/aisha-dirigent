#!/usr/bin/env node
/**
 * scripts/blue-green-switch.mjs — Phase 2 of AUTONOMOUS_DEPLOY_FLOW
 * ─────────────────────────────────────────────────────────────────────────────
 * Atomický blue/green switch protokol pro per-Coolify-app B/G slots.
 *
 * Sekvence (success path):
 *   1. acquire_slot_lock RPC (atomic)
 *   2. Determine target_slot = opposite(active_slot)
 *   3. Coolify API: PATCH env vars on target slot (image_tag, ...)
 *   4. Coolify API: POST /deploy?uuid={target} → wait for finished
 *   5. blue-green-smoke-test edge fn → assert healthy
 *   6. fn_evaluate_proposal_risk → if high → WF_APPROVAL_GATE → wait
 *   7. Coolify API: PATCH Traefik labels swap (atomic 2-call sequence)
 *   8. commit_slot_switch RPC (releases lock + updates active_slot)
 *
 * Failure paths invoke abort_slot_switch + log.
 *
 * Usage:
 *   node scripts/blue-green-switch.mjs [options]
 *
 * Options:
 *   --app <name>            App name (e.g., aisha-gateway) [required]
 *   --target-slot <slot>    blue|green (default: opposite of active)
 *   --image-tag <tag>       New image tag for target slot [required]
 *   --triggered-by <kind>   ci_push|manual|drift_remediation (default: manual)
 *   --skip-smoke-test       Skip smoke test (DANGEROUS, dev only)
 *   --skip-approval-gate    Skip approval gate (DANGEROUS, only with --force)
 *   --force                 Required for skip flags
 *   --dry-run               Print steps without executing
 *   --json                  Emit JSON output (for n8n)
 *   --quiet                 Suppress info logs
 *   --help
 *
 * Environment:
 *   COOLIFY_API_TOKEN, COOLIFY_API_URL
 *   AISHA_POSTGREST_URL, AISHA_POSTGREST_SERVICE_KEY
 *   N8N_WEBHOOK_URL (for approval gate)
 *
 * Spec: docs/deploy/BLUE_GREEN_DESIGN.md §3 Switch protokol
 * ─────────────────────────────────────────────────────────────────────────────
 */

import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// ── Args ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

const opts = {
  app: getArg("--app"),
  targetSlot: getArg("--target-slot"),
  imageTag: getArg("--image-tag"),
  triggeredBy: getArg("--triggered-by") || "manual",
  skipSmoke: args.includes("--skip-smoke-test"),
  skipApproval: args.includes("--skip-approval-gate"),
  force: args.includes("--force"),
  dryRun: args.includes("--dry-run"),
  json: args.includes("--json"),
  quiet: args.includes("--quiet"),
};

if (args.includes("--help") || args.includes("-h")) {
  console.error("Usage: node scripts/blue-green-switch.mjs --app <name> --image-tag <tag> [options]");
  process.exit(0);
}

if (!opts.app) {
  console.error("✗ --app is required");
  process.exit(1);
}
if (!opts.imageTag) {
  console.error("✗ --image-tag is required");
  process.exit(1);
}
if ((opts.skipSmoke || opts.skipApproval) && !opts.force) {
  console.error("✗ --skip-* flags require --force");
  process.exit(1);
}

// ── Injection hardening ──────────────────────────────────────────────────────
// These values originate in a webhook payload and reach this script through an
// n8n executeCommand *shell* interpolation. The workflow's "Parse event" node
// validates them at source; re-assert a strict charset here so a direct or
// alternative invocation can never smuggle shell metacharacters downstream.
const SAFE_APP = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SAFE_SLOT = /^(blue|green)$/;
const SAFE_TAG = /^[A-Za-z0-9._:@/-]{1,128}$/;
if (!SAFE_APP.test(opts.app)) {
  console.error(`✗ --app has invalid characters: ${JSON.stringify(opts.app)}`);
  process.exit(1);
}
if (opts.targetSlot && !SAFE_SLOT.test(opts.targetSlot)) {
  console.error(`✗ --target-slot must be blue|green: ${JSON.stringify(opts.targetSlot)}`);
  process.exit(1);
}
if (!SAFE_TAG.test(opts.imageTag)) {
  console.error(`✗ --image-tag has invalid characters: ${JSON.stringify(opts.imageTag)}`);
  process.exit(1);
}

const log = {
  info: (...a) => !opts.quiet && !opts.json && console.error("ℹ", ...a),
  warn: (...a) => !opts.json && console.error("⚠", ...a),
  error: (...a) => console.error("✗", ...a),
  ok: (...a) => !opts.quiet && !opts.json && console.error("✓", ...a),
  step: (n, ...a) => !opts.quiet && !opts.json && console.error(`\n═══ Step ${n}: ${a.join(" ")} ═══`),
};

// ── RPC helper ─────────────────────────────────────────────────────────────

async function rpc(name, params = {}) {
  const url = (process.env.AISHA_POSTGREST_URL || "http://127.0.0.1:3001") + "/rest/v1/rpc/" + name;
  const key = process.env.AISHA_POSTGREST_SERVICE_KEY;
  if (!key) throw new Error("AISHA_POSTGREST_SERVICE_KEY not set");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": key,
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RPC ${name} failed (${res.status}): ${text}`);
  }
  return await res.json();
}

// ── Coolify API helper ─────────────────────────────────────────────────────

async function coolify(method, path, body) {
  const apiUrl = process.env.COOLIFY_API_URL;
  const token = process.env.COOLIFY_API_TOKEN;
  if (!apiUrl || !token) throw new Error("COOLIFY_API_URL or COOLIFY_API_TOKEN not set");

  const res = await fetch(apiUrl.replace(/\/$/, "") + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Coolify API ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return await res.json();
}

// ── Public Traefik router labels ────────────────────────────────────────────
// Builds the Traefik router label block that binds the public host to a slot.
// The concrete host comes from the DB slot row (coolify_app_slots.domain) — no
// shell-default fallbacks, no deployment literals baked into source.
function buildPublicRouterLabels(appName, publicDomain) {
  const router = `${appName}-public`;
  return [
    "traefik.enable=true",
    `traefik.http.routers.${router}.rule=Host(\`${publicDomain}\`)`,
    `traefik.http.routers.${router}.entrypoints=https`,
    `traefik.http.routers.${router}.tls=true`,
    `traefik.http.routers.${router}.tls.certresolver=letsencrypt`,
  ].join("\n");
}

// ── Smoke test (inline HTTP probes) ────────────────────────────────────────

async function runSmokeTest(baseUrl, healthPaths, timeoutMs = 30000) {
  const startedAt = Date.now();
  const probes = [];
  for (const p of healthPaths) {
    const probeStart = Date.now();
    try {
      const url = `${baseUrl}${p}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { method: "GET", signal: ctrl.signal });
      clearTimeout(timer);
      probes.push({
        path: p,
        status: res.status,
        duration_ms: Date.now() - probeStart,
        success: res.ok,
      });
    } catch (err) {
      probes.push({
        path: p,
        status: 0,
        duration_ms: Date.now() - probeStart,
        success: false,
        error: String(err).slice(0, 200),
      });
    }
  }
  const allPassed = probes.every((p) => p.success);
  return {
    success: allPassed,
    duration_ms: Date.now() - startedAt,
    probes,
    failure_reason: allPassed ? undefined : `${probes.filter(p => !p.success).length}/${probes.length} probes failed`,
  };
}

// ── Wait for deployment ─────────────────────────────────────────────────────

async function waitForDeployment(uuid, timeoutMs = 300000, intervalMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const data = await coolify("GET", `/applications/${uuid}/deployments?per_page=1`);
    const dep = data?.deployments?.[0];
    const status = dep?.status || "unknown";
    log.info(`  Deployment status: ${status}`);
    if (status === "finished") return { ok: true, status };
    if (status === "failed" || status === "cancelled") return { ok: false, status };
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { ok: false, status: "timeout" };
}

// ── Main protocol ──────────────────────────────────────────────────────────

async function main() {
  const lockOwner = `blue-green-switch-${randomUUID().slice(0, 8)}-${process.pid}`;
  const switchStartedAt = Date.now();
  const result = {
    app_name: opts.app,
    target_slot: null,
    image_tag: opts.imageTag,
    triggered_by: opts.triggeredBy,
    started_at: new Date(switchStartedAt).toISOString(),
    completed_at: null,
    status: "in_progress",
    steps: [],
    error: null,
  };

  function step(name, status, details = {}) {
    const entry = { name, status, at: new Date().toISOString(), ...details };
    result.steps.push(entry);
    if (!opts.json && !opts.quiet) {
      const symbol = status === "success" ? "✓" : status === "skipped" ? "○" : status === "failed" ? "✗" : "·";
      console.error(`  ${symbol} ${name}: ${status}${details.detail ? ` (${details.detail})` : ""}`);
    }
  }

  let slotRow;
  try {
    // ── Step 1: Acquire lock ─────────────────────────────────────────────
    log.step(1, "Acquire lock");
    if (opts.dryRun) {
      step("acquire_lock", "skipped", { detail: "dry-run" });
      slotRow = { app_name: opts.app, active_slot: "blue" }; // mock
    } else {
      slotRow = await rpc("acquire_slot_lock", {
        p_app_name: opts.app,
        p_lock_owner: lockOwner,
      });
      step("acquire_lock", "success", { active_slot: slotRow.active_slot });
    }

    // ── Step 2: Determine target ────────────────────────────────────────
    const targetSlot = opts.targetSlot || (slotRow.active_slot === "blue" ? "green" : "blue");
    if (targetSlot === slotRow.active_slot) {
      throw new Error(`Target slot ${targetSlot} already active`);
    }
    result.target_slot = targetSlot;
    const targetUuid = targetSlot === "blue" ? slotRow.blue_app_uuid : slotRow.green_app_uuid;
    step("resolve_target", "success", { target_slot: targetSlot, target_uuid: targetUuid });

    if (opts.dryRun) {
      step("dry_run_complete", "success");
      result.status = "dry_run";
      return finalize(result);
    }

    // ── Step 3: Update image_tag env on target ───────────────────────────
    log.step(3, "Update image_tag on target slot");
    await coolify("PATCH", `/applications/${targetUuid}/envs`, {
      key: "IMAGE_TAG",
      value: opts.imageTag,
    });
    step("update_image_tag", "success");

    // ── Step 4: Deploy target ────────────────────────────────────────────
    log.step(4, "Deploy target slot");
    const deployRes = await coolify("POST", `/deploy?uuid=${targetUuid}&force=true`, null);
    log.info(`  Deployment triggered: ${deployRes?.deployments?.[0]?.deployment_uuid || "unknown"}`);
    const waitRes = await waitForDeployment(targetUuid);
    if (!waitRes.ok) {
      throw new Error(`Deployment did not finish: ${waitRes.status}`);
    }
    step("deploy_target", "success", { detail: `status=${waitRes.status}` });

    // ── Step 5: Smoke test (inline HTTP probes) ──────────────────────────
    log.step(5, "Smoke test");
    let smokeResult = { success: true, probes: [], skipped: opts.skipSmoke };
    if (!opts.skipSmoke) {
      const targetUrl = `https://${targetSlot === "blue" ? slotRow.internal_domain_blue : slotRow.internal_domain_green}`;
      const healthPaths = ["/api/v1/health", "/healthz"];
      smokeResult = await runSmokeTest(targetUrl, healthPaths, 30000);
      if (!smokeResult.success) {
        throw new Error(`Smoke test failed: ${smokeResult.failure_reason || smokeResult.probes.filter(p => !p.success).map(p => p.path).join(", ")}`);
      }
    }
    step("smoke_test", opts.skipSmoke ? "skipped" : "success", { detail: opts.skipSmoke ? "force-skipped" : `${smokeResult.probes?.length || 0} probes` });

    // ── Step 6: Risk evaluation + approval gate ─────────────────────────
    log.step(6, "Risk evaluation");
    if (!opts.skipApproval) {
      const risk = await rpc("fn_evaluate_proposal_risk", {
        p_agent_slug: "blue_green_orchestrator",
        p_category: "blue_green_switch",
        p_metadata: {
          app_name: opts.app,
          target_slot: targetSlot,
          image_tag_change: { from: slotRow[`${slotRow.active_slot}_image_tag`], to: opts.imageTag },
          triggered_by: opts.triggeredBy,
          smoke_test_passed: !!smokeResult.success,
        },
      });
      log.info(`  Risk: ${risk}`);
      step("risk_evaluation", "success", { detail: `risk=${risk}` });

      if (risk === "high" || risk === "critical") {
        // Approval gate — call WF_APPROVAL_GATE webhook
        log.warn(`  High risk → approval gate required (manual approval needed before traffic switch)`);
        // For CLI: we just log and exit waiting for orchestrator workflow to drive this.
        // n8n orchestrator workflow handles approval flow + retry.
        step("approval_gate", "pending", { detail: "manual approval required; CLI exits here" });
        result.status = "approval_pending";
        await rpc("abort_slot_switch", {
          p_app_name: opts.app,
          p_lock_owner: lockOwner,
          p_reason: "approval_pending_cli_exit",
        });
        return finalize(result);
      }
    } else {
      step("risk_evaluation", "skipped", { detail: "force-skipped" });
    }

    // ── Step 7: Switch Traefik labels (atomic 2-call docker_labels PATCH) ─
    log.step(7, "Swap Traefik labels");
    const oldActiveSlot = slotRow.active_slot;
    const publicDomain = slotRow.domain;
    if (!publicDomain) {
      throw new Error(`No public domain configured for app ${opts.app} (coolify_app_slots.domain) — cannot build Traefik route`);
    }

    // Resolve BOTH slot app UUIDs dynamically — they are regenerated on every
    // --wipe, so nothing is hardcoded. Prefer the DB-tracked slot UUIDs; fall
    // back to the shared Coolify resolver by application NAME.
    let targetSlotUuid = targetUuid;
    let oldActiveUuid = oldActiveSlot === "blue" ? slotRow.blue_app_uuid : slotRow.green_app_uuid;
    if (!targetSlotUuid || !oldActiveUuid) {
      const { resolveUuid } = await import("./lib/coolify-resolve-uuid.mjs");
      targetSlotUuid = targetSlotUuid || (await resolveUuid(`${opts.app}-${targetSlot}`));
      oldActiveUuid = oldActiveUuid || (await resolveUuid(`${opts.app}-${oldActiveSlot}`));
    }
    if (!targetSlotUuid || !oldActiveUuid) {
      throw new Error(`Could not resolve slot app UUIDs (target=${opts.app}-${targetSlot}, old=${opts.app}-${oldActiveSlot})`);
    }

    // The public Traefik router binds the public host to whichever slot is
    // active. Swapping traffic = add the router labels to the target app, then
    // remove them from the old active app. Coolify persists container labels in
    // the application's `docker_labels` field (newline-separated key=value).
    const publicRouterLabels = buildPublicRouterLabels(opts.app, publicDomain);

    // 7a. ADD the public route to the target slot (both briefly serve it).
    await coolify("PATCH", `/applications/${targetSlotUuid}`, {
      docker_labels: publicRouterLabels,
    });
    // 7b. REMOVE the public route from the old active slot (target is now the
    //     sole public backend — atomic completion of the swap).
    await coolify("PATCH", `/applications/${oldActiveUuid}`, {
      docker_labels: "",
    });
    step("traefik_swap", "success", {
      detail: `docker_labels PATCH ×2: +${targetSlot} / -${oldActiveSlot} (${publicDomain})`,
      target_uuid: targetSlotUuid,
    });

    // ── Step 8: Commit switch ───────────────────────────────────────────
    log.step(8, "Commit slot switch");
    const committed = await rpc("commit_slot_switch", {
      p_app_name: opts.app,
      p_new_active_slot: targetSlot,
      p_image_tag: opts.imageTag,
      p_lock_owner: lockOwner,
      p_actor: null,
    });
    step("commit", "success", { active_slot: committed.active_slot });

    result.status = "success";
    result.completed_at = new Date().toISOString();
  } catch (err) {
    log.error(err.message);
    result.status = "failed";
    result.error = err.message;
    result.completed_at = new Date().toISOString();
    step("error", "failed", { detail: err.message });

    // Best-effort abort
    try {
      await rpc("abort_slot_switch", {
        p_app_name: opts.app,
        p_lock_owner: lockOwner,
        p_reason: `error: ${err.message.slice(0, 200)}`,
      });
      step("abort_lock", "success");
    } catch (abortErr) {
      step("abort_lock", "failed", { detail: abortErr.message });
    }
  }

  return finalize(result);
}

function finalize(result) {
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error(`\n═══ Switch ${result.status.toUpperCase()} ═══`);
    console.error(`  App: ${result.app_name}`);
    console.error(`  Target: ${result.target_slot || "n/a"}`);
    console.error(`  Image: ${result.image_tag}`);
    if (result.error) console.error(`  Error: ${result.error}`);
  }
  process.exit(result.status === "success" || result.status === "dry_run" ? 0 : 1);
}

main().catch((err) => {
  console.error(JSON.stringify({ status: "error", error: err.message, stack: err.stack }, null, 2));
  process.exit(2);
});
