#!/usr/bin/env node
/**
 * eval-capabilities.mjs — capability gate evaluator.
 *
 * Reads:
 *   config/services.json          (catalog with optional `capabilities` block)
 *   config/profiles/<id>.json     (which services are included)
 *   .env-prod-backup              (operator-supplied external keys)
 *   .env.coolify                  (cold-start-generated keys)
 *   process.env                   (transient overrides)
 *   AISHA_PROFILE env             (default: cloud-multi)
 *
 * Emits (CLI):
 *   --json     Structured report (per-service enabled/disabled + reason).
 *   --shell    Bash-sourceable `<SVC_ID>_ENABLED=true|false` exports.
 *   --check    Exit 1 if any `tier=required` service is disabled.
 *   --profile=<id>   Override AISHA_PROFILE.
 *
 * Schema (per-service `capabilities` block, all keys optional):
 *
 *   "capabilities": {
 *     "requires_all_of": [<alternative>, ...],   // every entry must hold
 *     "requires_any_of": [<alternative>, ...]    // at least one must hold
 *   }
 *
 * Where each <alternative> is one of:
 *
 *   { "external_key": "ANTHROPIC_API_KEY" }       // non-empty in env sources
 *   { "local_service": "vllm" }                   // service id is enabled
 *                                                  // (transitive capability)
 *
 * Cascade: a service depending on `local_service: X` is disabled if X
 * itself is disabled. Dependency cycles are a hard error.
 *
 * Numbered protocol bindings (POSTGRES_PORT=5432 etc.) do NOT belong here.
 * Capabilities express *user-visible feature availability*, not internal
 * stack wiring.
 *
 * See docs/architecture/CAPABILITY_GATES.md.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "./cli-entry.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

// ── Helpers ──────────────────────────────────────────────────────────────────
function readJSON(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

/**
 * Read a bash-style env file into a Map. Skips comments and blank lines.
 * Returns the raw RHS as written (no shell substitution); empty values
 * mean "key present but unset by operator".
 */
function readEnvFile(path) {
  const out = new Map();
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, "utf-8").split("\n")) {
    const line = raw.replace(/^\s+/, "");
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq);
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
    let val = line.slice(eq + 1);
    // Strip matching surrounding quotes (single or double).
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out.set(key, val);
  }
  return out;
}

/**
 * Resolve the effective value of an external_key in the layered env sources.
 * Order (later wins): .env-prod-backup → .env.coolify → process.env.
 * Returns the trimmed string value, or "" if unset/empty anywhere.
 */
function resolveExternalKey(envProdBackup, envCoolify, processEnv, key) {
  const fromProcess = processEnv[key];
  if (fromProcess !== undefined && fromProcess !== "") return fromProcess.trim();
  const fromCoolify = envCoolify.get(key);
  if (fromCoolify !== undefined && fromCoolify !== "") return fromCoolify.trim();
  const fromBackup = envProdBackup.get(key);
  if (fromBackup !== undefined && fromBackup !== "") return fromBackup.trim();
  return "";
}

/**
 * Compute which services are *included* by a profile (after tier_filter +
 * exclude + include). Mirror of `derive-domains.mjs` logic. Returns a Set
 * of service IDs.
 */
function includedServices(catalog, profile) {
  const tierFilter = new Set(profile.tier_filter ?? []);
  const exclude = new Set(profile.exclude ?? []);
  const include = new Set(profile.include ?? []);
  const out = new Set();
  for (const [id, svc] of Object.entries(catalog.services)) {
    if (exclude.has(id)) continue;
    const includedByTier = tierFilter.has(svc.tier);
    const includedByOptIn = include.has(id);
    if (includedByTier || includedByOptIn) out.add(id);
  }
  return out;
}

/**
 * Evaluate one alternative {external_key} | {local_service} given the
 * already-computed decisions map (for cascade). Returns:
 *   { satisfied: bool, kind: "external_key"|"local_service", target, reason }
 */
function evaluateAlternative(
  alt,
  { envProdBackup, envCoolify, processEnv, decisions, catalog, included },
) {
  if ("external_key" in alt) {
    const value = resolveExternalKey(envProdBackup, envCoolify, processEnv, alt.external_key);
    return {
      satisfied: value !== "",
      kind: "external_key",
      target: alt.external_key,
      reason: value === ""
        ? `external_key ${alt.external_key} not set`
        : `external_key ${alt.external_key} present`,
    };
  }
  if ("local_service" in alt) {
    const target = alt.local_service;
    // Reach into extras for local-only runtime services (vllm/ollama).
    const isExtra = catalog.extras && target in catalog.extras;
    if (isExtra) {
      // Local-only services are never deployed in cloud profiles. The
      // operator opts in by exporting `LOCAL_SERVICE_<NAME>=1` so the
      // capability evaluator can see them as enabled.
      const flag = processEnv[`LOCAL_SERVICE_${target.toUpperCase()}`] === "1";
      return {
        satisfied: flag,
        kind: "local_service",
        target,
        reason: flag
          ? `local_service ${target} enabled via LOCAL_SERVICE_${target.toUpperCase()}=1`
          : `local_service ${target} not enabled (set LOCAL_SERVICE_${target.toUpperCase()}=1 to opt in)`,
      };
    }
    // Cascade into another service's decision.
    if (!included.has(target)) {
      return {
        satisfied: false,
        kind: "local_service",
        target,
        reason: `local_service ${target} not in profile`,
      };
    }
    const decision = decisions.get(target);
    if (!decision) {
      // Should not happen — caller should evaluate in dependency order.
      return {
        satisfied: false,
        kind: "local_service",
        target,
        reason: `local_service ${target} not yet evaluated (cycle?)`,
      };
    }
    return {
      satisfied: decision.enabled,
      kind: "local_service",
      target,
      reason: decision.enabled
        ? `local_service ${target} enabled`
        : `local_service ${target} disabled (${decision.reason})`,
    };
  }
  return {
    satisfied: false,
    kind: "unknown",
    target: JSON.stringify(alt),
    reason: `unknown alternative shape: ${JSON.stringify(alt)}`,
  };
}

/**
 * Topological sort of services by `capabilities.requires_*` `local_service`
 * edges. Throws on cycles.
 */
function topoSortByCapabilities(catalog, includedSet) {
  const services = [...includedSet];
  const edges = new Map(services.map((id) => [id, new Set()])); // id → deps
  for (const id of services) {
    const caps = catalog.services[id]?.capabilities;
    if (!caps) continue;
    for (const alt of [...(caps.requires_all_of ?? []), ...(caps.requires_any_of ?? [])]) {
      if ("local_service" in alt) {
        const target = alt.local_service;
        if (includedSet.has(target)) edges.get(id).add(target);
      }
    }
  }
  const visited = new Set();
  const inStack = new Set();
  const order = [];
  function visit(id) {
    if (visited.has(id)) return;
    if (inStack.has(id)) {
      throw new Error(`Capability dependency cycle involving ${id}`);
    }
    inStack.add(id);
    for (const dep of edges.get(id)) visit(dep);
    inStack.delete(id);
    visited.add(id);
    order.push(id);
  }
  for (const id of services) visit(id);
  return order;
}

/**
 * Main evaluation entry. Returns:
 *   { profile, services: { [id]: { enabled, reason, satisfied_by?, missing? } } }
 */
export function evaluateCapabilities({
  catalog,
  profile,
  envProdBackup,
  envCoolify,
  processEnv,
}) {
  const included = includedServices(catalog, profile);
  const order = topoSortByCapabilities(catalog, included);
  const decisions = new Map();

  for (const id of order) {
    const svc = catalog.services[id];
    const caps = svc.capabilities;
    if (!caps) {
      decisions.set(id, { enabled: true, reason: "no capabilities required" });
      continue;
    }
    const ctx = {
      envProdBackup,
      envCoolify,
      processEnv,
      decisions,
      catalog,
      included,
    };

    const allOf = (caps.requires_all_of ?? []).map((alt) =>
      evaluateAlternative(alt, ctx),
    );
    const anyOf = (caps.requires_any_of ?? []).map((alt) =>
      evaluateAlternative(alt, ctx),
    );

    const allOfPass = allOf.every((e) => e.satisfied);
    const anyOfPass = anyOf.length === 0 || anyOf.some((e) => e.satisfied);

    const enabled = allOfPass && anyOfPass;
    let reason;
    let satisfiedBy;
    let missing;
    if (enabled) {
      reason = anyOf.length > 0
        ? `satisfied by ${anyOf.find((e) => e.satisfied).target} (any-of)`
        : "all-of requirements met";
      satisfiedBy = [...anyOf.filter((e) => e.satisfied), ...allOf.filter((e) => e.satisfied)];
    } else if (!allOfPass) {
      const failedAll = allOf.filter((e) => !e.satisfied);
      reason = `requires_all_of unmet: ${failedAll.map((e) => e.reason).join("; ")}`;
      missing = failedAll;
    } else {
      reason = `requires_any_of unmet: no alternative satisfied (${anyOf.map((e) => e.reason).join("; ")})`;
      missing = anyOf;
    }
    const decision = { enabled, reason };
    if (satisfiedBy) decision.satisfied_by = satisfiedBy.map(({ kind, target }) => ({ [kind]: target }));
    if (missing) decision.missing = missing.map(({ kind, target, reason: r }) => ({ [kind]: target, reason: r }));
    decisions.set(id, decision);
  }

  const services = {};
  // Emit in declaration order (services.json order), not topo order, for
  // stable downstream consumption. Excluded services get a deterministic
  // "excluded by profile" entry so consumers don't see undefined.
  for (const [id, svc] of Object.entries(catalog.services)) {
    if (!included.has(id)) {
      services[id] = {
        enabled: false,
        reason: "excluded by profile (tier_filter / exclude)",
        tier: svc.tier,
      };
      continue;
    }
    services[id] = { ...decisions.get(id), tier: svc.tier };
  }

  return { profile: profile.id ?? "unknown", services };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function loadInputs(profileId) {
  const catalog = readJSON(resolve(ROOT, "config", "services.json"));
  const profile = readJSON(
    resolve(ROOT, "config", "profiles", `${profileId}.json`),
  );
  const envProdBackup = readEnvFile(resolve(ROOT, ".env-prod-backup"));
  const envCoolify = readEnvFile(resolve(ROOT, ".env.coolify"));
  return { catalog, profile, envProdBackup, envCoolify, processEnv: process.env };
}

function parseArgs(argv) {
  let mode = "json";
  let profile = process.env.AISHA_PROFILE || "cloud-multi";
  for (const a of argv) {
    if (a === "--json") mode = "json";
    else if (a === "--shell") mode = "shell";
    else if (a === "--check") mode = "check";
    else if (a.startsWith("--profile=")) profile = a.slice("--profile=".length);
  }
  return { mode, profile };
}

// Strážce vstupu má jeden domov: lib/cli-entry.mjs. Dřív tu stálo porovnání
// `import.meta.url === `file://${process.argv[1]}`` — to je ale porovnání
// ZÁPISU cesty: URL je percent-enkódovaná, argv[1] syrový. Na cestě s
// diakritikou se rozejdou a blok se TIŠE přeskočí (naměřeno 2026-08-14:
// resolver vydal 0 bajtů s kódem 0 a shodil tím dvanáct bran).
if (isDirectRun(import.meta.url)) {
  const { mode, profile: profileId } = parseArgs(process.argv.slice(2));
  const inputs = loadInputs(profileId);
  const report = evaluateCapabilities(inputs);

  if (mode === "json") {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else if (mode === "shell") {
    const lines = [];
    lines.push(`# capability gates — profile=${report.profile}`);
    for (const [id, decision] of Object.entries(report.services)) {
      const flag = decision.enabled ? "true" : "false";
      const safe = id.toUpperCase().replace(/-/g, "_");
      lines.push(`${safe}_ENABLED=${flag}`);
    }
    process.stdout.write(lines.join("\n") + "\n");
  } else if (mode === "check") {
    let exit = 0;
    for (const [id, decision] of Object.entries(report.services)) {
      if (decision.tier === "required" && !decision.enabled) {
        process.stderr.write(`✗ required service '${id}' is disabled: ${decision.reason}\n`);
        exit = 1;
      } else if (!decision.enabled && decision.tier !== "required") {
        process.stderr.write(`~ ${decision.tier} service '${id}' disabled: ${decision.reason}\n`);
      } else {
        process.stderr.write(`✓ ${id}: ${decision.reason}\n`);
      }
    }
    process.exit(exit);
  }
}
