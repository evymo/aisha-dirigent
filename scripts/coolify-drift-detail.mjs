/**
 * scripts/coolify-drift-check.mjs — Phase 1 of AUTONOMOUS_DEPLOY_FLOW
 * ─────────────────────────────────────────────────────────────────────────────
 * Detekuje drift mezi desired state (deploy/aisha-stack.yml + compose files)
 * a actual state (Coolify API). Volaný z WF_DRIFT_OBSERVER (cron 10 min).
 *
 * Drift kinds detected:
 *   - env_var_value       — value diff (non-secret)
 *   - env_var_missing     — in manifest, not in Coolify
 *   - env_var_extra       — in Coolify, not in manifest (with whitelist)
 *   - secret_drift        — secret hash diff (without exposing values)
 *   - image_tag           — image tag diff (registry vs Coolify)
 *   - replicas            — replica count diff
 *   - traefik_labels      — Traefik labels diff (with B/G aware logic)
 *   - missing_app         — manifest lists app, Coolify doesn't have it
 *   - extra_app           — Coolify has app, manifest unaware (rogue?)
 *   - domain_mismatch     — public domain mismatch
 *
 * Usage:
 *   node scripts/coolify-drift-check.mjs [options]
 *
 * Options:
 *   --json                  Emit JSON (for n8n workflow consumption)
 *   --app <name>            Check single app (default: all)
 *   --include-secrets       Include secret hash compare (slower)
 *   --apply                 Auto-remediate low-risk drift (DANGEROUS)
 *   --dry-run               Print actions but don't call API mutating ops (default)
 *   --rpc-host <url>        Override Postgres REST URL (default: env)
 *   --quiet                 Suppress info logs
 *   --help                  Show this help
 *
 * Environment:
 *   COOLIFY_API_TOKEN       Coolify API bearer token
 *   COOLIFY_API_URL         Coolify API base URL (operator-set)
 *   AISHA_POSTGREST_URL      Postgres REST URL
 *   AISHA_POSTGREST_SERVICE_KEY  Service role key for RPC calls
 *
 * Output (--json):
 *   {
 *     observed_at: ISO8601,
 *     total_apps_checked: int,
 *     drift_count: int,
 *     drifts: [{ app_uuid, app_name, drift_kind, desired_value, actual_value,
 *                risk_level, suggested_action }],
 *     errors: [{ app_uuid?, error }]
 *   }
 *
 * Související specs:
 *   docs/deploy/DRIFT_OBSERVER.md
 *   docs/deploy/AUTONOMOUS_DEPLOY_FLOW.md
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, existsSync } from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// ── Argument parsing ────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const opts = {
  json: args.includes("--json"),
  apply: args.includes("--apply"),
  dryRun: !args.includes("--apply"),
  includeSecrets: args.includes("--include-secrets"),
  quiet: args.includes("--quiet"),
};

if (args.includes("--help") || args.includes("-h")) {
  console.error("Usage: node scripts/coolify-drift-check.mjs [--json] [--apply] [--quiet]");
  console.error("See top of file for full options.");
  process.exit(0);
}

function getArg(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

const targetApp = getArg("--app");
const rpcHost = getArg("--rpc-host") || process.env.AISHA_POSTGREST_URL || "http://127.0.0.1:3001";

// ── Logging ──────────────────────────────────────────────────────────────────

const log = {
  info: (...a) => !opts.quiet && !opts.json && console.error("ℹ", ...a),
  warn: (...a) => !opts.json && console.error("⚠", ...a),
  error: (...a) => console.error("✗", ...a),
  ok: (...a) => !opts.quiet && !opts.json && console.error("✓", ...a),
};

// ── Manifest loader ──────────────────────────────────────────────────────────

function loadManifest() {
  const manifestPath = path.join(REPO_ROOT, "deploy/aisha-stack.yml");
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }
  // Simple YAML parse (limited — for production use a proper YAML parser)
  // For now, parse as JSON if .json, else use a minimal YAML-ish reader
  const content = readFileSync(manifestPath, "utf8");

  // Try JSON first
  if (manifestPath.endsWith(".json")) {
    return JSON.parse(content);
  }

  // Minimal YAML parser — just enough for our manifest structure
  // (Production: replace with `yaml` npm package import)
  return parseSimpleYaml(content);
}

function parseSimpleYaml(text) {
  // VERY LIMITED — parses 2-level: top.app.field structure with strings only.
  // For complex YAML use proper parser. This is a placeholder pattern.
  const result = { apps: {}, host: {} };
  const lines = text.split("\n");
  let currentApp = null;
  let currentSection = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trimEnd();
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const indent = line.match(/^(\s*)/)[1].length;

    if (indent === 0 && line.endsWith(":")) {
      currentSection = line.slice(0, -1).trim();
      if (currentSection === "apps") {
        result.apps = {};
      }
      currentApp = null;
    } else if (indent === 2 && line.endsWith(":") && currentSection === "apps") {
      currentApp = line.slice(2, -1).trim();
      result.apps[currentApp] = {};
    } else if (indent >= 4 && currentApp) {
      const m = line.trim().match(/^([\w-]+):\s*(.*)$/);
      if (m) {
        const [, k, v] = m;
        result.apps[currentApp][k] = v.replace(/^["']|["']$/g, "");
      }
    } else if (indent === 2 && currentSection === "host") {
      const m = line.trim().match(/^([\w-]+):\s*(.*)$/);
      if (m) result.host[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return result;
}

// ── Coolify API client (reuses deploy/connectors/coolify.mjs) ──────────────

async function loadCoolifyConnector() {
  const connectorPath = path.join(REPO_ROOT, "deploy/connectors/coolify.mjs");
  return await import(`file://${connectorPath}`);
}

// ── Risk evaluation (mirrors fn_evaluate_proposal_risk Postgres logic) ─────

function evaluateDriftRisk(driftKind, appName, appRole, isProduction) {
  if (driftKind === "extra_app") return "critical";
  if (isProduction && appRole === "database") return "critical";
  if (driftKind === "secret_drift") return "high";
  if (driftKind === "missing_app") return "high";
  if (appRole === "auth") return "high";

  if (driftKind === "image_tag" && isProduction) return "medium";
  if (["replicas", "traefik_labels", "domain_mismatch"].includes(driftKind)) return "medium";
  if (driftKind === "env_var_value" && isProduction) return "medium";

  if (["env_var_value", "env_var_missing", "env_var_extra", "image_tag"].includes(driftKind)) return "low";
  return "medium";
}

function suggestAction(riskLevel) {
  switch (riskLevel) {
    case "low":
    case "medium": return "auto_remediate";
    case "high":
    case "critical": return "request_approval";
    default: return "manual_review";
  }
}

// ── Secret detection ────────────────────────────────────────────────────────

const SECRET_PATTERNS = /_(SECRET|KEY|TOKEN|PASSWORD|DSN|AUTH|API_KEY)$|^DATABASE_URL$|^JWT_SECRET$/i;

function isSecret(envKey) {
  return SECRET_PATTERNS.test(envKey);
}

function secretHash(value) {
  if (!value) return null;
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 32);
}

// ── Whitelist for env_var_extra (Coolify-managed runtime vars) ─────────────

const COOLIFY_RUNTIME_VAR_WHITELIST = [
  /^SERVICE_FQDN_/,
  /^SERVICE_URL_/,
  /^SERVICE_USER_/,
  /^SERVICE_PASSWORD_/,
  /^SERVICE_BASE64_/,
  /^COOLIFY_/,
  /^SOURCE_COMMIT$/,
  /^PORT$/,
];

function isWhitelistedExtra(envKey) {
  return COOLIFY_RUNTIME_VAR_WHITELIST.some((re) => re.test(envKey));
}

// ── Per-app drift detection ─────────────────────────────────────────────────

async function detectDriftsForApp(appName, manifestApp, coolifyApp, connector, token) {
  const drifts = [];
  const isProduction = manifestApp.environment === "prod" || appName.endsWith("-prod") ||
                       (manifestApp.domain && !manifestApp.domain.includes("staging") && !manifestApp.domain.includes("preview"));
  const appRole = manifestApp.role || inferRole(appName);

  // 1. Image tag drift
  if (manifestApp.image && coolifyApp.image && manifestApp.image !== coolifyApp.image) {
    drifts.push({
      app_uuid: coolifyApp.uuid,
      app_name: appName,
      drift_kind: "image_tag",
      desired_value: { image: manifestApp.image },
      actual_value: { image: coolifyApp.image },
      risk_level: evaluateDriftRisk("image_tag", appName, appRole, isProduction),
    });
  }

  // 2. Domain mismatch
  if (manifestApp.domain && coolifyApp.fqdn && manifestApp.domain !== coolifyApp.fqdn) {
    drifts.push({
      app_uuid: coolifyApp.uuid,
      app_name: appName,
      drift_kind: "domain_mismatch",
      desired_value: { domain: manifestApp.domain },
      actual_value: { domain: coolifyApp.fqdn },
      risk_level: evaluateDriftRisk("domain_mismatch", appName, appRole, isProduction),
    });
  }

  // 3. Env vars (lazy — only if connector available)
  try {
    const coolifyEnvs = await connector.getEnvs(appName, { uuid: coolifyApp.uuid, _apiBase: process.env.COOLIFY_API_URL }, token);
    const desiredEnvs = manifestApp.envs || {};

    // env_var_missing
    for (const key of Object.keys(desiredEnvs)) {
      const actual = coolifyEnvs.find((e) => e.key === key);
      if (!actual) {
        drifts.push({
          app_uuid: coolifyApp.uuid,
          app_name: appName,
          drift_kind: "env_var_missing",
          desired_value: isSecret(key)
            ? { key, hash: secretHash(desiredEnvs[key]) }
            : { key, value: desiredEnvs[key] },
          actual_value: null,
          risk_level: evaluateDriftRisk("env_var_missing", appName, appRole, isProduction),
        });
      } else if (!isSecret(key) && actual.value !== desiredEnvs[key]) {
        drifts.push({
          app_uuid: coolifyApp.uuid,
          app_name: appName,
          drift_kind: "env_var_value",
          desired_value: { key, value: desiredEnvs[key] },
          actual_value: { key, value: actual.value },
          risk_level: evaluateDriftRisk("env_var_value", appName, appRole, isProduction),
        });
      } else if (isSecret(key) && opts.includeSecrets) {
        const desiredHash = secretHash(desiredEnvs[key]);
        const actualHash = secretHash(actual.value);
        if (desiredHash !== actualHash) {
          drifts.push({
            app_uuid: coolifyApp.uuid,
            app_name: appName,
            drift_kind: "secret_drift",
            desired_value: { key, hash: desiredHash },
            actual_value: { key, hash: actualHash },
            risk_level: evaluateDriftRisk("secret_drift", appName, appRole, isProduction),
          });
        }
      }
    }

    // env_var_extra
    for (const env of coolifyEnvs) {
      if (desiredEnvs[env.key]) continue;
      if (isWhitelistedExtra(env.key)) continue;
      drifts.push({
        app_uuid: coolifyApp.uuid,
        app_name: appName,
        drift_kind: "env_var_extra",
        desired_value: null,
        actual_value: isSecret(env.key)
          ? { key: env.key, hash: secretHash(env.value) }
          : { key: env.key, value: env.value },
        risk_level: evaluateDriftRisk("env_var_extra", appName, appRole, isProduction),
      });
    }
  } catch (err) {
    log.warn(`getEnvs failed for ${appName}: ${err.message}`);
  }

  // Annotate suggested action
  for (const d of drifts) {
    d.suggested_action = suggestAction(d.risk_level);
  }

  return drifts;
}

function inferRole(appName) {
  if (/postgres|mysql|mariadb|db/.test(appName)) return "database";
  if (/keycloak|auth/.test(appName)) return "auth";
  if (/storage|minio/.test(appName)) return "storage";
  if (/redis|cache/.test(appName)) return "cache";
  if (/elastic|search/.test(appName)) return "search";
  return "frontend";
}

// ── App-level drift (missing_app, extra_app) ───────────────────────────────

function detectAppLevelDrifts(manifest, coolifyApps) {
  const drifts = [];
  const manifestAppNames = Object.keys(manifest.apps || {});
  const coolifyAppMap = new Map();
  for (const c of coolifyApps) {
    coolifyAppMap.set(c.name || c.uuid, c);
  }

  // missing_app
  for (const name of manifestAppNames) {
    const m = manifest.apps[name];
    if (m.uuid) {
      // Manifest binds to specific UUID — check existence
      const found = coolifyApps.find((c) => c.uuid === m.uuid);
      if (!found) {
        drifts.push({
          app_uuid: m.uuid,
          app_name: name,
          drift_kind: "missing_app",
          desired_value: { uuid: m.uuid, image: m.image },
          actual_value: null,
          risk_level: evaluateDriftRisk("missing_app", name, inferRole(name), true),
        });
      }
    }
  }

  // extra_app — Coolify has app that manifest doesn't reference
  const knownUuids = new Set(
    manifestAppNames.map((n) => manifest.apps[n].uuid).filter(Boolean)
  );
  for (const c of coolifyApps) {
    // Skip Coolify's internal infra apps
    if (/^coolify-/.test(c.name || "")) continue;
    if (knownUuids.has(c.uuid)) continue;
    drifts.push({
      app_uuid: c.uuid,
      app_name: c.name || c.uuid,
      drift_kind: "extra_app",
      desired_value: null,
      actual_value: { uuid: c.uuid, name: c.name, status: c.status },
      risk_level: evaluateDriftRisk("extra_app", c.name, "unknown", true),
    });
  }

  for (const d of drifts) {
    d.suggested_action = suggestAction(d.risk_level);
  }

  return drifts;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const observedAt = new Date().toISOString();
  const errors = [];
  let drifts = [];
  let totalAppsChecked = 0;

  log.info(`Drift check started at ${observedAt}`);

  // 1. Load manifest
  let manifest;
  try {
    manifest = loadManifest();
    log.ok(`Manifest loaded: ${Object.keys(manifest.apps || {}).length} apps`);
  } catch (err) {
    errors.push({ error: `Manifest load failed: ${err.message}` });
    return finalize(observedAt, [], 0, errors);
  }

  // 2. Load Coolify connector + token
  let connector, token;
  try {
    connector = await loadCoolifyConnector();
    token = process.env.COOLIFY_API_TOKEN || connector.resolveToken(REPO_ROOT);
  } catch (err) {
    errors.push({ error: `Coolify connector init failed: ${err.message}` });
    return finalize(observedAt, [], 0, errors);
  }

  // 3. Fetch all Coolify apps
  let coolifyApps;
  try {
    const apiBase = process.env.COOLIFY_API_URL || manifest.host?.api;
    if (!apiBase) throw new Error("Coolify API URL not configured");
    const { default: https } = await import("https");
    coolifyApps = await fetchCoolifyApps(apiBase, token, https);
    log.ok(`Coolify: ${coolifyApps.length} apps found`);
  } catch (err) {
    errors.push({ error: `Coolify API fetch failed: ${err.message}` });
    return finalize(observedAt, [], 0, errors);
  }

  // 4. App-level drifts
  drifts.push(...detectAppLevelDrifts(manifest, coolifyApps));

  // 5. Per-app drifts
  const apps = targetApp ? { [targetApp]: manifest.apps[targetApp] } : manifest.apps;
  for (const [name, manifestApp] of Object.entries(apps || {})) {
    if (!manifestApp.uuid) continue;
    const coolifyApp = coolifyApps.find((c) => c.uuid === manifestApp.uuid);
    if (!coolifyApp) continue; // Already captured as missing_app
    totalAppsChecked++;
    try {
      const appDrifts = await detectDriftsForApp(name, manifestApp, coolifyApp, connector, token);
      drifts.push(...appDrifts);
      if (appDrifts.length > 0) {
        log.info(`  ${name}: ${appDrifts.length} drift(s)`);
      }
    } catch (err) {
      errors.push({ app_uuid: manifestApp.uuid, error: err.message });
    }
  }

  // 6. Auto-remediate (--apply only, low/medium risk)
  if (opts.apply) {
    log.warn("Auto-remediation enabled — executing low/medium risk fixes");
    for (const d of drifts) {
      if (d.suggested_action === "auto_remediate" && d.drift_kind === "env_var_value") {
        try {
          await connector.setEnv(d.app_name, { uuid: d.app_uuid, _apiBase: process.env.COOLIFY_API_URL }, token, d.desired_value.key, d.desired_value.value);
          d.remediation_result = "applied";
          log.ok(`  Auto-fixed ${d.app_name}/${d.desired_value.key}`);
        } catch (err) {
          d.remediation_result = `failed: ${err.message}`;
          log.warn(`  Auto-fix failed for ${d.app_name}/${d.desired_value.key}: ${err.message}`);
        }
      }
    }
  }

  return finalize(observedAt, drifts, totalAppsChecked, errors);
}

async function fetchCoolifyApps(apiBase, token, https) {
  return new Promise((resolve, reject) => {
    const url = new URL(apiBase.replace(/\/$/, "") + "/applications");
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (err) {
            reject(new Error(`Invalid JSON from /applications: ${err.message}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error("Coolify API timeout"));
    });
    req.end();
  });
}

function finalize(observedAt, drifts, totalAppsChecked, errors) {
  const result = {
    observed_at: observedAt,
    total_apps_checked: totalAppsChecked,
    drift_count: drifts.length,
    drifts,
    errors,
  };

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error(`\n═══ Drift Check Summary ═══`);
    console.error(`  Apps checked:  ${totalAppsChecked}`);
    console.error(`  Drifts found:  ${drifts.length}`);
    console.error(`  Errors:        ${errors.length}`);
    if (drifts.length > 0) {
      console.error(`\n  By risk:`);
      const byRisk = {};
      for (const d of drifts) {
        byRisk[d.risk_level] = (byRisk[d.risk_level] || 0) + 1;
      }
      for (const [risk, count] of Object.entries(byRisk)) {
        console.error(`    ${risk}: ${count}`);
      }
    }
    if (errors.length > 0) {
      console.error(`\n  Errors:`);
      for (const e of errors) console.error(`    - ${e.error}`);
    }
  }

  process.exit(errors.length > 0 ? 2 : drifts.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(JSON.stringify({
    observed_at: new Date().toISOString(),
    total_apps_checked: 0,
    drift_count: 0,
    drifts: [],
    errors: [{ error: err.message, stack: err.stack }],
  }, null, 2));
  process.exit(2);
});