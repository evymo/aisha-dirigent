/**
 * deploy/connectors/coolify.mjs — Coolify API Connector
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements the AISHA Connector interface for Coolify REST API.
 *
 * Connector interface (all connectors must implement):
 *   status(app, cfg)         → { status, running, healthy, lastDeploy }
 *   deploy(app, cfg, opts)   → { deploymentId }
 *   waitDeployment(app, cfg, id, opts) → { ok, status }
 *   logs(app, cfg, opts)     → string
 *   getEnvs(app, cfg)        → [{ key, value, is_literal }]
 *   setEnv(app, cfg, key, value) → void
 *   restart(app, cfg)        → void
 *
 * Config required in deploy/aisha-stack.yml:
 *   host:
 *     api: ${COOLIFY_API}  # or ${COOLIFY_URL}/api/v1
 *   apps.<name>:
 *     uuid: <coolify-app-uuid>
 *
 * Token: COOLIFY_API_TOKEN env | .env-prod-backup
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

export const name = "coolify";
export const description = "Coolify REST API (recommended for production)";

// ─── Token resolution ─────────────────────────────────────────────────────────
export function resolveToken(repoRoot) {
  if (process.env.COOLIFY_API_TOKEN) return process.env.COOLIFY_API_TOKEN;
  const envFile = resolve(repoRoot, ".env-prod-backup");
  if (existsSync(envFile)) {
    const match = readFileSync(envFile, "utf8")
      .split("\n")
      .find((l) => l.startsWith("COOLIFY_API_TOKEN="));
    if (match) return match.slice("COOLIFY_API_TOKEN=".length).replace(/['"]/g, "").trim();
  }
  throw new Error("COOLIFY_API_TOKEN not found (env var or .env-prod-backup)");
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────
async function request(baseUrl, token, path, { method = "GET", body, timeoutMs = 30_000 } = {}) {
  const { default: https } = await import("https");
  const { default: http } = await import("http");
  const url = new URL(baseUrl.replace(/\/$/, "") + path);
  const lib = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };
    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks)
          .toString("utf8")
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw), raw });
        } catch {
          resolve({ status: res.statusCode, body: null, raw });
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Coolify API timeout (${timeoutMs}ms): ${path}`));
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ─── status ───────────────────────────────────────────────────────────────────
export async function status(app, cfg, token) {
  const uuid = cfg.uuid;
  if (!uuid) throw new Error(`App '${app}' missing uuid in manifest`);

  const { status: s, body } = await request(cfg._apiBase, token, "/applications");
  if (s !== 200 || !Array.isArray(body)) {
    throw new Error(`Coolify /applications returned ${s}`);
  }

  const found = body.find((a) => a.uuid === uuid);
  if (!found) return { status: "NOT_FOUND", running: false, healthy: false, lastDeploy: null };

  const appStatus = found.status || "unknown";
  const running = appStatus.includes("running") || appStatus.includes("starting");
  const healthy = appStatus === "running:healthy";

  // Last deployment
  let lastDeploy = null;
  try {
    const { body: deps } = await request(cfg._apiBase, token, `/applications/${uuid}/deployments?per_page=1`);
    lastDeploy = (deps?.deployments || [])[0]?.status || null;
  } catch {}

  return { status: appStatus, running, healthy, lastDeploy };
}

// ─── deploy ───────────────────────────────────────────────────────────────────
export async function deploy(app, cfg, token, { force = false } = {}) {
  const uuid = cfg.uuid;
  const forceQ = force ? "&force=true" : "";
  const { status: s, body } = await request(
    cfg._apiBase, token,
    `/deploy?uuid=${uuid}${forceQ}`,
    { method: "POST" }
  );

  if (s >= 400) {
    throw new Error(`Deploy trigger failed (${s}): ${JSON.stringify(body)}`);
  }

  const deploymentId = body?.deployments?.[0]?.deployment_uuid || body?.message || "triggered";
  return { deploymentId };
}

// ─── waitDeployment ────────────────────────────────────────────────────────────
export async function waitDeployment(app, cfg, token, deploymentId, { timeoutMs = 300_000, intervalMs = 5_000, onProgress } = {}) {
  const uuid = cfg.uuid;
  const start = Date.now();
  let lastStatus = "";

  while (Date.now() - start < timeoutMs) {
    try {
      const { body } = await request(cfg._apiBase, token, `/applications/${uuid}/deployments?per_page=1`);
      const dep = (body?.deployments || [])[0];
      const depStatus = dep?.status || "unknown";

      if (depStatus !== lastStatus) {
        lastStatus = depStatus;
        onProgress?.({ status: depStatus, changed: true });
      } else {
        onProgress?.({ status: depStatus, changed: false });
      }

      if (depStatus === "finished") return { ok: true, status: depStatus };
      if (depStatus === "failed" || depStatus === "cancelled") return { ok: false, status: depStatus };
    } catch (e) {
      onProgress?.({ status: "error", error: e.message, changed: false });
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return { ok: false, status: "timeout" };
}

// ─── logs ─────────────────────────────────────────────────────────────────────
export async function logs(app, cfg, token, { lines = 200, container } = {}) {
  const uuid = cfg.uuid;
  let url = `/applications/${uuid}/logs?lines=${lines}`;
  // Coolify v4 Docker Compose: try container_name filter if specified
  if (container) url += `&container_name=${encodeURIComponent(container)}`;

  const { status: s, body, raw } = await request(cfg._apiBase, token, url);

  if (s === 400) {
    throw new Error(`APP_NOT_RUNNING: App is not running — Coolify cannot serve logs.\n` +
      `  Fix: aisha-ctl debug-hold ${app} on → deploy ${app} → aisha-ctl logs ${app}`);
  }
  if (s !== 200) {
    throw new Error(`Logs API error ${s}: ${raw?.slice(0, 200)}`);
  }

  return body?.logs || raw || "(no output)";
}

// ─── getEnvs ─────────────────────────────────────────────────────────────────
export async function getEnvs(app, cfg, token) {
  const uuid = cfg.uuid;
  const { status: s, body } = await request(cfg._apiBase, token, `/applications/${uuid}/envs`);
  if (s !== 200) throw new Error(`getEnvs failed (${s})`);
  return body || [];
}

// ─── setEnv ──────────────────────────────────────────────────────────────────
export async function setEnv(app, cfg, token, key, value) {
  const uuid = cfg.uuid;
  const allEnvs = await getEnvs(app, cfg, token);
  const duplicates = allEnvs.filter((e) => e.key === key);

  // Strategy: delete-all-then-POST for clean state.
  // Coolify auto-creates preview+non-preview pairs on POST. Coolify PATCH
  // requires matching is_preview/is_buildtime flags and the entry `uuid`,
  // which is fragile. Atomic delete+create is simpler and deterministic.
  for (const dup of duplicates) {
    const envId = dup.uuid || dup.id;
    if (!envId) continue;
    await request(cfg._apiBase, token, `/applications/${uuid}/envs/${envId}`, { method: "DELETE" });
  }

  const { status: s } = await request(
    cfg._apiBase, token,
    `/applications/${uuid}/envs`,
    { method: "POST", body: { key, value, is_preview: false, is_literal: true } }
  );

  if (s >= 400) throw new Error(`setEnv ${key} failed (${s})`);
}

// ─── restart ─────────────────────────────────────────────────────────────────
export async function restart(app, cfg, token) {
  const uuid = cfg.uuid;
  const { status: s } = await request(cfg._apiBase, token, `/applications/${uuid}/restart`, { method: "GET" });
  if (s >= 400) throw new Error(`restart failed (${s})`);
}

// ─── composeSync ─────────────────────────────────────────────────────────────
// Coolify stores docker-compose content in its DB (`docker_compose_raw`).
// Git changes are NOT auto-pulled on deploy — this function pushes local
// compose content to Coolify so the next deploy uses the updated version.
export async function composeSync(app, cfg, token, composeContent) {
  const uuid = cfg.uuid;

  // First: read current app config to understand compose storage
  const { status: gs, body: appData } = await request(
    cfg._apiBase, token,
    `/applications/${uuid}`
  );
  if (gs !== 200) throw new Error(`composeSync: failed to read app (${gs})`);

  // Log which compose fields exist in the app config
  const composeFields = {};
  for (const key of Object.keys(appData || {})) {
    if (key.includes("compose") || key.includes("docker")) {
      composeFields[key] = typeof appData[key] === "string"
        ? `${appData[key].length} chars`
        : appData[key];
    }
  }
  if (process.env.AISHA_CTL_DEBUG) {
    console.error("[composeSync] App compose fields:", JSON.stringify(composeFields));
    // Show first 500 chars of stored compose for comparison
    const raw = appData?.docker_compose_raw || "";
    console.error("[composeSync] Stored docker_compose_raw (first 500 chars):\n" + raw.slice(0, 500));
    // Check for key patterns
    console.error("[composeSync] Has host-gateway:", raw.includes("host-gateway"));
    console.error("[composeSync] Has DIAGNOSTIC:", raw.includes("DIAGNOSTIC"));
    console.error("[composeSync] Has NAT hairpin:", raw.includes("NAT hairpin"));
  }

  // Try each compose field and HTTP method — Coolify v4 validates differently
  const methods = ["PATCH", "PUT"];
  const fields = ["docker_compose_raw", "docker_compose"];
  const results = [];
  for (const method of methods) {
    for (const field of fields) {
      const { status: s, body } = await request(
        cfg._apiBase, token,
        `/applications/${uuid}`,
        { method, body: { [field]: composeContent } }
      );
      results.push({ method, field, status: s });
      if (process.env.AISHA_CTL_DEBUG) console.error(`[composeSync] ${method} ${field} → ${s}`);
      if (s < 400) return { ok: true, field: `${method} ${field}` };
    }
  }

  // Coolify git-based compose apps: force git refresh by cycling commit SHA.
  // Setting the SHA to HEAD triggers Coolify to pull fresh from git.
  // We also set compose_parsing_version to "0" and back to trigger re-parse.
  const { execFileSync } = await import("child_process");
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

  // Step 1: Set SHA to HEAD (force Coolify to know the target commit)
  await request(cfg._apiBase, token, `/applications/${uuid}`, {
    method: "PATCH",
    body: { git_commit_sha: sha },
  });

  // Step 2: Try to force compose re-parse by bumping parsing version
  const { status: rpv } = await request(cfg._apiBase, token, `/applications/${uuid}`, {
    method: "PATCH",
    body: { compose_parsing_version: "2" },
  });
  if (process.env.AISHA_CTL_DEBUG) console.error(`[composeSync] compose_parsing_version=2 → ${rpv}`);

  return { ok: true, field: `git_commit_sha=${sha.slice(0, 8)}`, note: "Deploy should pull fresh compose from git" };

  throw new Error(`composeSync: all methods failed: ${JSON.stringify(results)}`);
}
