#!/usr/bin/env node
/**
 * fix-buildtime-flags.mjs — bulk-set is_buildtime=true on non-web apps
 *
 * One-shot remediation: for every aisha-* application (except aisha-edge / web),
 * set is_buildtime=true on all non-preview env vars. This is required for
 * Compose interpolation — Coolify only passes buildtime vars into the
 * docker-compose .env file.
 *
 * Web apps (aisha-edge) keep the original VITE_/SENTRY_/PUBLIC_SITE_URL/GIT_SHA
 * regex (handled by coolify-sync-envs.sh).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createProjectScope } from "./lib/coolify-project-scope.mjs";
import { hodnotaZCoolify } from "./lib/coolify-env-hodnota.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_BACKUP = resolve(ROOT, ".env-prod-backup");
const COOLIFY_BASE = (() => {
  const v = process.env.COOLIFY_BASE_URL;
  if (!v) { process.stderr.write("FATAL: COOLIFY_BASE_URL required\n"); process.exit(2); }
  return v;
})();
const API_BASE = `${COOLIFY_BASE}/api/v1`;
const WEB_APPS = new Set(["aisha-edge", "aisha-web", "edge", "web"]);

function loadToken() {
  if (process.env.COOLIFY_API_TOKEN) {
    return process.env.COOLIFY_API_TOKEN.replace(/^["']|["']$/g, "");
  }
  for (const line of readFileSync(ENV_BACKUP, "utf8").split(/\r?\n/)) {
    if (line.startsWith("COOLIFY_API_TOKEN=")) {
      return line.slice("COOLIFY_API_TOKEN=".length).trim().replace(/^["']|["']$/g, "");
    }
  }
  throw new Error("COOLIFY_API_TOKEN missing");
}
const TOKEN = loadToken();

async function api(path, init = {}) {
  // Retry up to 3x with exponential backoff for transient Coolify timeouts
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(`${API_BASE}${path}`, {
        ...init,
        signal: AbortSignal.timeout(120_000),
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers || {}),
        },
      });
      const t = await r.text();
      if (!r.ok) throw new Error(`HTTP ${r.status} ${path}: ${t.slice(0, 200)}`);
      return t ? JSON.parse(t.replace(/[\x00-\x1f]/g, "")) : null;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
  throw lastErr;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function patchKey(uuid, key) {
  // Some Coolify versions require full envs PATCH per key
  const body = { key, is_preview: false, is_buildtime: true };
  // up to 3 retries with 1s backoff
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      await api(`/applications/${uuid}/envs`, { method: "PATCH", body: JSON.stringify(body) });
      return true;
    } catch (e) {
      lastErr = e;
      await sleep(1000);
    }
  }
  console.error(`  ✗ ${key}: ${lastErr.message.slice(0, 120)}`);
  return false;
}

async function main() {
  const apps = await api("/applications");
  // Confine to OUR project — never PATCH another tenant's same-named aisha-*
  // app on the shared host. Fail-loud without COOLIFY_PROJECT_UUID.
  const scope = await createProjectScope(api);
  const targets = apps.filter(
    (a) => scope.inProject(a) && a.name?.startsWith("aisha-") && !WEB_APPS.has(a.name),
  );
  console.log(`Found ${targets.length} non-web aisha-* apps to fix\n`);

  for (const app of targets) {
    const envs = await api(`/applications/${app.uuid}/envs`);
    const tofix = envs.filter((e) => !e.is_preview && !e.is_buildtime);
    if (tofix.length === 0) {
      console.log(`✓ ${app.name.padEnd(22)} already OK (${envs.length} envs)`);
      continue;
    }
    console.log(`→ ${app.name.padEnd(22)} bulk-fixing ${tofix.length}/${envs.length} keys...`);
    // Try bulk PATCH first with metadata
    try {
      const body = {
        data: tofix.map((e) => ({
          key: e.key,
          // Skutečná hodnota, ne tvar pro .env: `real_value` literálu by sem
          // zapsal apostrofy natrvalo. Příznaky literal/multiline se zachovají.
          value: hodnotaZCoolify(e),
          is_literal: e.is_literal === true,
          is_multiline: e.is_multiline === true,
          is_preview: false,
          is_buildtime: true,
        })),
      };
      await api(`/applications/${app.uuid}/envs/bulk`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      // Verify
      const after = await api(`/applications/${app.uuid}/envs`);
      const stillBroken = after.filter((e) => !e.is_preview && !e.is_buildtime).length;
      if (stillBroken === 0) {
        console.log(`  ${app.name.padEnd(22)} ✓ bulk OK`);
        continue;
      }
      console.log(`  ${app.name.padEnd(22)} bulk left ${stillBroken} broken — falling back to per-key`);
    } catch (e) {
      console.log(`  ${app.name.padEnd(22)} bulk failed (${e.message.slice(0, 80)}) — per-key fallback`);
    }
    // Per-key fallback
    let ok = 0, fail = 0;
    for (const e of tofix) {
      const r = await patchKey(app.uuid, e.key);
      if (r) ok++; else fail++;
    }
    console.log(`  ${app.name.padEnd(22)} ✓ ${ok} fixed, ✗ ${fail} failed`);
  }
  console.log("\nDone.");
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
