#!/usr/bin/env node
/**
 * render-app-config.mjs — Render public/.well-known/app-config.template.json
 * to app-config.json by substituting ${VAR} placeholders from process.env or
 * config/domains.env (operator SoT).
 *
 * Invoked from cold-start (after env is loaded) and from Dockerfile.web at
 * `npm run build` time, so the SPA bundle ships with the operator's deployed
 * URLs baked in. The gateway also serves a fresh copy at /.well-known/app-config.json
 * — this static file is the SPA fallback (used by mobile-app + extension).
 *
 * Usage:
 *   node scripts/render-app-config.mjs              # writes public/.well-known/app-config.json
 *   APP_DOMAIN=web.example.com node scripts/render-app-config.mjs
 *   APP_CONFIG_OUT=/tmp/x.json node scripts/render-app-config.mjs  # write elsewhere
 *                                                   # (tests MUST use this — the
 *                                                   # default overwrites the repo's
 *                                                   # tracked stub regardless of cwd)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TEMPLATE = resolve(ROOT, "public/.well-known/app-config.template.json");
const OUTPUT = process.env.APP_CONFIG_OUT
  ? resolve(process.env.APP_CONFIG_OUT)
  : resolve(ROOT, "public/.well-known/app-config.json");

if (!existsSync(TEMPLATE)) {
  console.error(`[render-app-config] template not found: ${TEMPLATE}`);
  process.exit(2);
}

// Load config/domains.env for fallback values (SoT)
function loadDomains() {
  const file = resolve(ROOT, "config/domains.env");
  const out = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  // expand ${X} references
  for (const k of Object.keys(out)) {
    out[k] = out[k].replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, n) => out[n] ?? "");
  }
  return out;
}

const DOMAINS = loadDomains();
const resolveVar = (name) => process.env[name] ?? DOMAINS[name] ?? "";

const template = readFileSync(TEMPLATE, "utf8");

// _comment is template metadata, not config — drop it BEFORE substitution so a
// literal "${VAR}" example inside the comment never registers as a required
// variable (it made every strict render FATAL with `missing values for: VAR`,
// killing the aisha-core web build on cold-start 2026-06-11).
const templateObj = JSON.parse(template);
delete templateObj._comment;
const source = JSON.stringify(templateObj, null, 2);

// OPTIONAL feature-domain vars — empty is NOT a fatal config error here:
//   1. Each is an optional integration (Matrix chat, Dirigent, public gateway
//      face) that may be absent in a given deployment/topology.
//   2. The authoritative app-config is served FRESH-FROM-ENV by the gateway at
//      runtime (/.well-known/app-config.json); this baked file is only the SPA
//      bundle fallback (see template _comment). So an empty value here just
//      means "feature off in the fallback", with the live value supplied at
//      runtime. Coolify also passes these as runtime (not build-time) env, so
//      they are legitimately empty during the web build.
// Core vars (API/APP/KEYCLOAK/ANON) are NOT listed → they stay fail-loud.
const OPTIONAL = new Set(["MATRIX_DOMAIN", "DIRIGENT_DOMAIN", "GATEWAY_DOMAIN_PUBLIC"]);

const missing = [];
const rendered = source.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (match, name) => {
  const value = resolveVar(name);
  if (!value && !OPTIONAL.has(name)) missing.push(name);
  return value;
});

if (missing.length > 0) {
  const uniq = [...new Set(missing)];
  console.error(`[render-app-config] FATAL: missing values for: ${uniq.join(", ")}`);
  console.error(`[render-app-config] set them in env or config/domains.env`);
  process.exit(1);
}

const parsed = JSON.parse(rendered);
writeFileSync(OUTPUT, JSON.stringify(parsed, null, 2) + "\n");

console.log(`[render-app-config] wrote ${OUTPUT}`);
