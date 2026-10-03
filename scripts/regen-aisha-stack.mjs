#!/usr/bin/env node
/**
 * scripts/regen-aisha-stack.mjs — Regenerate deploy/aisha-stack.yml from Coolify
 *
 * Reads live Coolify state (frontend.${PUBLIC_TLD}) and writes a fresh
 * deploy/aisha-stack.yml manifest with current UUIDs for all aisha-* apps.
 *
 * Usage:
 *   node scripts/regen-aisha-stack.mjs            # write to deploy/aisha-stack.yml
 *   node scripts/regen-aisha-stack.mjs --print    # print to stdout, no write
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PATH = resolve(REPO_ROOT, "deploy/aisha-stack.yml");
const COOLIFY_BASE = process.env.COOLIFY_URL;
if (!COOLIFY_BASE) {
  console.error("ERROR: COOLIFY_URL not set (env-driven; no hardcoded host)");
  process.exit(1);
}
const API = `${COOLIFY_BASE}/api/v1`;
const PRINT_ONLY = process.argv.includes("--print");

// ── Server name → role map ───────────────────────────────────────────────────
const SERVER_ROLE = { frontend: "edge", backend: "backend", experimental: "exec" };

// ── App metadata (compose path, depends_on, critical, group) ────────────────
// Single source of truth aligned with coolify/manifests/aisha.manifest (v3, 12 apps)
const APP_META = {
  edge:          { compose: "docker-compose.coolify-prebuilt.yml",   server: "frontend", group: "frontend",  depends_on: ["core", "keycloak"], is_frontend: true, description: "Web SPA (nginx prebuilt)" },
  netbird:       { compose: "docker-compose.coolify-netbird.yml",    server: "frontend", group: "infra",     depends_on: [],                                       description: "Netbird mesh (mgmt+signal+relay)" },
  core:          { compose: "docker-compose.coolify.yml",            server: "backend",  group: "core",      depends_on: ["keycloak"],         critical: true,    debug_env: "AISHA_MIGRATE_DEBUG_HOLD", description: "PG17 + PostgREST + aisha-gateway + svc-plugin-system + svc-mcp-knowledge + MinIO + Redis + pgAdmin" },
  keycloak:      { compose: "docker-compose.coolify-keycloak.yml",   server: "backend",  group: "auth",      depends_on: [],                   critical: true,    description: "Keycloak SSO / OIDC" },
  pki:           { compose: "docker-compose.coolify-pki.yml",        server: "backend",  group: "infra",     depends_on: [],                                       description: "OpenXPKI internal CA" },
  orchestration: { compose: "docker-compose.coolify-n8n.yml",        server: "backend",  group: "services",  depends_on: ["core"],                                description: "n8n workflow engine" },
  messaging:     { compose: "docker-compose.coolify-matrix.yml",     server: "backend",  group: "services",  depends_on: ["keycloak"],                            description: "Matrix Synapse + Element" },
  observability: { compose: "docker-compose.coolify-langfuse.yml",   server: "backend",  group: "data",      depends_on: ["core"],                                description: "Langfuse LLM observability" },
  admin:         { compose: "docker-compose.coolify-admin.yml",      server: "backend",  group: "frontend",  depends_on: ["core", "keycloak"],                    description: "NocoDB + Appsmith admin" },
  integration:   { compose: "docker-compose.coolify-integration.yml",server: "backend",  group: "services",  depends_on: ["core", "keycloak"],                    description: "Ragnarok RAG + Elasticsearch + RabbitMQ" },
  ledger:        { compose: "docker-compose.coolify-cosmos.yml",     server: "experimental", group: "infra",     depends_on: [],                                       description: "Cosmos SDK validator (RPC public)" },
  exec:          { compose: "docker-compose.coolify-exec.yml",       server: "experimental", group: "services",  depends_on: ["core"],                                description: "svc-agent-runner (Kata Containers)" },
};

// ── Topological deploy order from depends_on ────────────────────────────────
function topoSort(meta) {
  const visited = new Set();
  const result = [];
  function visit(name) {
    if (visited.has(name)) return;
    visited.add(name);
    for (const dep of meta[name]?.depends_on || []) {
      if (meta[dep]) visit(dep);
    }
    result.push(name);
  }
  // Visit critical first, then rest alphabetically
  const critical = Object.keys(meta).filter((n) => meta[n].critical);
  const rest = Object.keys(meta).filter((n) => !meta[n].critical).sort();
  [...critical, ...rest].forEach(visit);
  return result;
}

// ── Token resolution ────────────────────────────────────────────────────────
function resolveToken() {
  if (process.env.COOLIFY_API_TOKEN) return process.env.COOLIFY_API_TOKEN;
  const envFile = resolve(REPO_ROOT, ".env-prod-backup");
  if (existsSync(envFile)) {
    const match = readFileSync(envFile, "utf8")
      .split("\n")
      .find((l) => l.startsWith("COOLIFY_API_TOKEN="));
    if (match) return match.slice("COOLIFY_API_TOKEN=".length).replace(/['"]/g, "").trim();
  }
  throw new Error("COOLIFY_API_TOKEN not found");
}

// ── Fetch all apps from Coolify ─────────────────────────────────────────────
async function fetchApps(token) {
  const res = await fetch(`${API}/applications`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Coolify API ${res.status}`);
  const raw = await res.text();
  const cleaned = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  return JSON.parse(cleaned);
}

// ── Render YAML manifest ────────────────────────────────────────────────────
function renderYaml(uuidByName, deployOrder, missing) {
  const groups = {};
  for (const name of Object.keys(APP_META)) {
    const g = APP_META[name].group;
    (groups[g] ||= []).push(name);
  }

  const lines = [];
  lines.push("# deploy/aisha-stack.yml — AISHA Platform Scope Manifest");
  lines.push("# ─────────────────────────────────────────────────────────────────────────────");
  lines.push("# AUTO-GENERATED by scripts/regen-aisha-stack.mjs");
  lines.push(`# Last regen: ${new Date().toISOString()}`);
  lines.push(`# Source of truth: live Coolify state (${COOLIFY_BASE})`);
  lines.push("# To regenerate: node scripts/regen-aisha-stack.mjs");
  lines.push("# ─────────────────────────────────────────────────────────────────────────────");
  lines.push(`version: "3"`);
  lines.push("");
  lines.push("# ── Connectors ──────────────────────────────────────────────────────────────");
  lines.push("connectors:");
  lines.push("  default: coolify");
  lines.push("  coolify:");
  lines.push(`    api: ${API}`);
  lines.push("    # COOLIFY_API_TOKEN read from .env-prod-backup or env var");
  lines.push("  ssh:");
  lines.push("    # ssh_host can be overridden per app via apps.<name>.ssh_host");
  lines.push("    host: ${AISHA_SSH_HOST:-aisha@" + (COOLIFY_BASE.replace(/^https?:\/\//, "")) + "}");
  lines.push("  local:");
  lines.push("    compose_file: docker-compose.local.yml");
  lines.push("");
  lines.push("# ── Servers (Coolify hosts) ─────────────────────────────────────────────────");
  lines.push("servers:");
  for (const [name, role] of Object.entries(SERVER_ROLE)) {
    lines.push(`  ${name}:`);
    lines.push(`    role: ${role}`);
  }
  lines.push("");
  lines.push("# ── Logical groups (for selective deploy) ───────────────────────────────────");
  lines.push("groups:");
  for (const [g, apps] of Object.entries(groups)) {
    lines.push(`  ${g.padEnd(10)}: [${apps.join(", ")}]`);
  }
  lines.push("");
  lines.push("# ── Canonical deploy order (topological — auth/infra first) ─────────────────");
  lines.push("deploy_order:");
  for (const name of deployOrder) lines.push(`  - ${name}`);
  lines.push("");
  lines.push("# ── Apps ────────────────────────────────────────────────────────────────────");
  lines.push("apps:");
  for (const name of deployOrder) {
    const m = APP_META[name];
    const uuid = uuidByName[`aisha-${name}`] || "MISSING";
    lines.push(`  ${name}:`);
    lines.push(`    uuid: ${uuid}`);
    lines.push(`    description: "${m.description}"`);
    lines.push(`    server: ${m.server}`);
    lines.push(`    compose: ${m.compose}`);
    if (m.critical) lines.push(`    critical: true`);
    if (m.is_frontend) lines.push(`    is_frontend: true`);
    if (m.debug_env) lines.push(`    debug_env: ${m.debug_env}`);
    lines.push(`    depends_on: [${m.depends_on.join(", ")}]`);
    lines.push("");
  }

  if (missing.length > 0) {
    lines.push("# ── WARNING ─────────────────────────────────────────────────────────────────");
    lines.push("# The following apps were defined in APP_META but NOT FOUND on Coolify:");
    for (const m of missing) lines.push(`#   - aisha-${m}`);
    lines.push("# Run aisha-cold-start.sh or coolify-story-init.sh to create them.");
  }

  return lines.join("\n") + "\n";
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const token = resolveToken();
  const apps = await fetchApps(token);
  const aisha = apps.filter((a) => a.name?.startsWith("aisha-"));
  const uuidByName = Object.fromEntries(aisha.map((a) => [a.name, a.uuid]));

  const deployOrder = topoSort(APP_META);
  const missing = deployOrder.filter((n) => !uuidByName[`aisha-${n}`]);

  console.error(`Coolify aisha-* apps found: ${aisha.length}/${deployOrder.length}`);
  if (missing.length) console.error(`Missing: ${missing.map((n) => "aisha-" + n).join(", ")}`);

  const yaml = renderYaml(uuidByName, deployOrder, missing);

  if (PRINT_ONLY) {
    process.stdout.write(yaml);
  } else {
    writeFileSync(OUT_PATH, yaml);
    console.error(`Wrote ${OUT_PATH}`);
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
