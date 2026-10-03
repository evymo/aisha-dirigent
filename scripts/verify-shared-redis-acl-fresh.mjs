#!/usr/bin/env node
/**
 * verify-shared-redis-acl-fresh.mjs — catch a STALE shared-redis ACL.
 *
 * INCIDENT 2026-07-05: aisha-realtime (event-worker / ws-gateway /
 * svc-ide-context) crash-looped for hours with `NOAUTH Authentication required`.
 * Root cause: `REDIS_PASSWORD_CORE` was rotated in the Coolify env at 06:01, but
 * aisha-shared-redis — which BAKES its `users.acl` from that env at container
 * start — was never redeployed, so its live ACL kept the OLD password while the
 * consumers connected with the NEW one. The failure is silent: Coolify reaps the
 * crashed consumer containers and nothing points at Redis.
 *
 * DETECTION (Coolify-API only, no in-cluster Redis reachability needed): a
 * shared secret rotated in the stored env only takes effect on the apps that
 * have been (re)deployed SINCE the rotation. So for each REDIS_PASSWORD_* secret
 * we take its latest env `updated_at` and flag every app carrying it — the
 * shared-redis producer AND every consumer — whose last deployment predates that
 * rotation. Any straggler is a NOAUTH crash waiting to happen.
 *
 * SCOPE: project-scoped via createProjectScope (fail-loud without
 * COOLIFY_PROJECT_UUID) so it never inspects another tenant's apps on the shared
 * host — same contract as the rest of the orchestration (#605).
 *
 * Usage:
 *   COOLIFY_PROJECT_UUID=<uuid> node scripts/verify-shared-redis-acl-fresh.mjs
 *   COOLIFY_PROJECT_UUID=<uuid> node scripts/verify-shared-redis-acl-fresh.mjs --json
 *   COOLIFY_PROJECT_UUID=<uuid> node scripts/verify-shared-redis-acl-fresh.mjs --heal
 *
 * Exit: 0 = fresh, 1 = stale ACL detected (or healed), 2 = usage/config error.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "./lib/cli-entry.mjs";
import { createCoolifyClient } from "./lib/coolify-http.mjs";
import { createProjectScope } from "./lib/coolify-project-scope.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The ACL producer and the secrets whose rotation invalidates its live ACL.
const REDIS_APP = "aisha-shared-redis";
const ACL_SECRET_RE = /^REDIS_PASSWORD(_[A-Z0-9]+)?$/;

/**
 * PURE decision core (unit-tested): given the latest rotation time of a shared
 * secret and each carrying app's last-deploy time, return the apps that have NOT
 * been redeployed since the rotation (their baked value / ACL is stale).
 *
 * @param {{ secret: string, updatedAt: string,
 *           apps: Array<{ name: string, deployedAt: string|null }> }} input
 * @returns {{ secret: string, stale: boolean, updatedAt: string,
 *             stragglers: string[], reason?: string }}
 */
export function detectStaleAcl({ secret, updatedAt, apps }) {
  const changed = Date.parse(updatedAt);
  if (!Number.isFinite(changed)) {
    return { secret, stale: false, updatedAt, stragglers: [], reason: "no rotation timestamp" };
  }
  const stragglers = [];
  for (const app of apps || []) {
    const deployed = app?.deployedAt == null ? NaN : Date.parse(app.deployedAt);
    // An app with NO known deploy time is treated as a straggler: we cannot
    // prove it picked up the rotated secret, and on a shared host that
    // uncertainty is a NOAUTH risk — fail-loud rather than assume fresh.
    if (!Number.isFinite(deployed) || deployed < changed) stragglers.push(app.name);
  }
  return { secret, stale: stragglers.length > 0, updatedAt, stragglers };
}

// ── CLI (skipped when imported by the gate/unit test) ────────────────────────
const isMain = isDirectRun(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const JSON_OUT = argv.includes("--json");
  const HEAL = argv.includes("--heal");

  const cfg = (key) => {
    if (process.env[key]) return process.env[key].replace(/^['"]|['"]$/g, "");
    const f = resolve(ROOT, ".env-prod-backup");
    if (!existsSync(f)) return "";
    for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
      if (line.startsWith(`${key}=`)) return line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, "");
    }
    return "";
  };
  const req = (key) => {
    const v = cfg(key);
    if (!v) { process.stderr.write(`FATAL: ${key} required\n`); process.exit(2); }
    return v;
  };

  const baseUrl = cfg("COOLIFY_BASE_URL") || req("COOLIFY_URL");
  const coolify = createCoolifyClient({ baseUrl, token: req("COOLIFY_API_TOKEN") });

  // Latest FINISHED deployment time for an app — when its containers (and any
  // env-baked ACL) were last recreated. Null when we cannot determine it.
  async function lastDeployAt(uuid) {
    try {
      const res = await coolify(`/deployments/applications/${uuid}?take=6`);
      const arr = Array.isArray(res) ? res : res?.deployments || res?.data || [];
      const finished = arr
        .filter((d) => /finished/i.test(d?.status || ""))
        .map((d) => d?.finished_at || d?.updated_at || d?.created_at)
        .filter(Boolean)
        .map((t) => Date.parse(t))
        .filter(Number.isFinite);
      if (finished.length) return new Date(Math.max(...finished)).toISOString();
    } catch (err) {
      // Non-fatal: an app with no readable deploy history is treated as a
      // straggler (unknown deploy time → stale) by detectStaleAcl, so we degrade
      // to null — but say so, never swallow silently.
      console.warn(`[acl-fresh] deploy history unavailable for ${uuid}: ${String(err?.message || err).slice(0, 120)}`);
    }
    return null;
  }

  const scope = await createProjectScope(coolify);
  const apps = scope.filter(await coolify("/applications"));
  const redisApp = apps.find((a) => a.name === REDIS_APP);
  if (!redisApp) {
    process.stderr.write(`FATAL: ${REDIS_APP} not found in project ${scope.projectUuid}\n`);
    process.exit(2);
  }

  // For every REDIS_PASSWORD_* secret on the producer, collect its rotation time
  // and the set of in-project apps (producer + consumers) that carry it.
  const producerEnvs = await coolify(`/applications/${redisApp.uuid}/envs`);
  const secretUpdatedAt = new Map();
  for (const e of producerEnvs || []) {
    if (ACL_SECRET_RE.test(e.key || "") && e.updated_at) {
      const prev = secretUpdatedAt.get(e.key);
      if (!prev || Date.parse(e.updated_at) > Date.parse(prev)) secretUpdatedAt.set(e.key, e.updated_at);
    }
  }

  // Map each secret → carrying apps (scan project apps' envs once).
  const carriers = new Map(); // secret -> Set(appUuid)
  const deployCache = new Map(); // appUuid -> deployedAt
  for (const app of apps) {
    let envs;
    try {
      envs = await coolify(`/applications/${app.uuid}/envs`);
    } catch (err) {
      // Non-fatal: skip an app whose env we cannot read, but log it — a missed
      // carrier could hide a straggler, so the operator must see the gap.
      console.warn(`[acl-fresh] env unreadable for ${app.name}, skipping: ${String(err?.message || err).slice(0, 120)}`);
      continue;
    }
    const keys = new Set((envs || []).map((e) => e.key));
    for (const secret of secretUpdatedAt.keys()) {
      if (keys.has(secret)) {
        if (!carriers.has(secret)) carriers.set(secret, new Map());
        carriers.get(secret).set(app.name, app.uuid);
      }
    }
  }
  // Deploy times (unique apps only).
  const uniqueUuids = new Set([...carriers.values()].flatMap((m) => [...m.values()]));
  for (const uuid of uniqueUuids) deployCache.set(uuid, await lastDeployAt(uuid));

  const reports = [];
  for (const [secret, updatedAt] of secretUpdatedAt) {
    const appMap = carriers.get(secret) || new Map();
    const appList = [...appMap.entries()].map(([name, uuid]) => ({ name, deployedAt: deployCache.get(uuid) ?? null, uuid }));
    reports.push({ ...detectStaleAcl({ secret, updatedAt, apps: appList }), _apps: appList });
  }

  const staleReports = reports.filter((r) => r.stale);

  if (JSON_OUT) {
    console.log(JSON.stringify({ project: scope.projectUuid, stale: staleReports.length > 0, reports: reports.map(({ _apps, ...r }) => r) }, null, 2));
  } else {
    console.log(`shared-redis ACL freshness — project ${scope.projectUuid}\n`);
    for (const r of reports) {
      if (!r.stale) { console.log(`  OK   ${r.secret} — all carriers deployed since rotation`); continue; }
      console.log(`  STALE ${r.secret} (rotated ${r.updatedAt}) — stragglers deployed BEFORE rotation:`);
      for (const name of r.stragglers) console.log(`         ✗ ${name}`);
    }
    if (staleReports.length) {
      console.log(`\n${staleReports.length} secret(s) with a stale ACL → redeploy ${REDIS_APP} FIRST, then the straggler consumers.`);
    } else {
      console.log(`\nAll REDIS_PASSWORD_* consumers are fresh — no NOAUTH drift.`);
    }
  }

  if (HEAL && staleReports.length) {
    // Redeploy the producer first (regenerate the ACL), then straggler consumers.
    const order = [];
    const seen = new Set();
    const push = (name) => { if (!seen.has(name)) { seen.add(name); order.push(name); } };
    push(REDIS_APP);
    for (const r of staleReports) for (const n of r.stragglers) push(n);
    const byName = new Map(apps.map((a) => [a.name, a.uuid]));
    console.log(`\n=== --heal: redeploying ${order.length} app(s) in order ===`);
    for (const name of order) {
      const uuid = byName.get(name);
      if (!uuid) { console.log(`  ? ${name} — uuid not found, skipping`); continue; }
      try {
        const res = await coolify(`/deploy?uuid=${uuid}&force=true`, { method: "GET" });
        const dep = res?.deployments?.[0]?.deployment_uuid || "?";
        console.log(`  → ${name} redeploy triggered (${dep})`);
      } catch (e) {
        console.log(`  ✗ ${name} redeploy failed: ${String(e?.message || e).slice(0, 100)}`);
      }
    }
  }

  process.exit(staleReports.length && !HEAL ? 1 : 0);
}
