#!/usr/bin/env node
/**
 * registry-cache.mjs — správa AISHA pull-through Docker Hub cache.
 *
 * Spouští se proti operator-set REGISTRY_URL (registry:2 v proxy módu),
 * kterou nasazuje docker-compose.coolify-registry.yml.
 *
 * Komandy:
 *   ls                    Vypsat repozitáře a tagy v cache.
 *   stats                 Souhrn (počet repos, tagů, bloby — je-li dostupné).
 *   rm <repo>:<tag>       Smazat manifest jednoho tagu (následuj `gc` pro reálné uvolnění).
 *   gc                    Trigger garbage collection v běžícím kontejneru.
 *
 * ENV (required + volitelné):
 *   REGISTRY_URL              REQUIRED — e.g. https://cache.<your-domain>:5000
 *   REGISTRY_PROXY_USERNAME   pokud je registry nakonfigurován s Docker Hub PAT
 *   REGISTRY_PROXY_PASSWORD
 *
 * Pozn. registry:2 v proxy módu cachuje vše bez TTL. Pravidelný `rm + gc` doporučen.
 */

import process from "node:process";

if (!process.env.REGISTRY_URL) {
  process.stderr.write("FATAL: REGISTRY_URL required (e.g. https://cache.<your-domain>:5000)\n");
  process.exit(2);
}
const REGISTRY_URL = process.env.REGISTRY_URL.replace(/\/+$/, "");
const AUTH_USER = process.env.REGISTRY_PROXY_USERNAME || "";
const AUTH_PASS = process.env.REGISTRY_PROXY_PASSWORD || "";

const authHeader = AUTH_USER
  ? { Authorization: `Basic ${Buffer.from(`${AUTH_USER}:${AUTH_PASS}`).toString("base64")}` }
  : {};

async function api(path, opts = {}) {
  const res = await fetch(`${REGISTRY_URL}${path}`, {
    ...opts,
    signal: AbortSignal.timeout(15_000),
    headers: {
      Accept: "application/vnd.docker.distribution.manifest.v2+json",
      ...authHeader,
      ...(opts.headers || {}),
    },
  });
  return res;
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function listRepos() {
  const res = await api("/v2/_catalog?n=1000");
  if (!res.ok) fail(`GET /v2/_catalog → ${res.status} ${res.statusText}`);
  const { repositories = [] } = await res.json();
  return repositories;
}

async function listTags(repo) {
  const res = await api(`/v2/${repo}/tags/list`);
  if (!res.ok) return [];
  const { tags = [] } = await res.json();
  return tags || [];
}

async function getDigest(repo, tag) {
  const res = await api(`/v2/${repo}/manifests/${tag}`, { method: "HEAD" });
  if (!res.ok) fail(`HEAD ${repo}:${tag} → ${res.status}`);
  return res.headers.get("docker-content-digest");
}

async function cmdLs() {
  const repos = await listRepos();
  if (repos.length === 0) {
    console.log("(prázdná cache)");
    return;
  }
  for (const repo of repos) {
    const tags = await listTags(repo);
    if (tags.length === 0) {
      console.log(`${repo}  (no tags)`);
    } else {
      for (const tag of tags) console.log(`${repo}:${tag}`);
    }
  }
}

async function cmdStats() {
  const repos = await listRepos();
  let totalTags = 0;
  for (const repo of repos) totalTags += (await listTags(repo)).length;
  console.log(`registry:    ${REGISTRY_URL}`);
  console.log(`repositories: ${repos.length}`);
  console.log(`tags total:   ${totalTags}`);
}

async function cmdRm(target) {
  if (!target || !target.includes(":")) fail("Použij: rm <repo>:<tag>");
  const lastColon = target.lastIndexOf(":");
  const repo = target.slice(0, lastColon);
  const tag = target.slice(lastColon + 1);
  const digest = await getDigest(repo, tag);
  if (!digest) fail(`Manifest ${repo}:${tag} nenalezen`);
  const res = await api(`/v2/${repo}/manifests/${digest}`, { method: "DELETE" });
  if (res.status === 202) {
    console.log(`✓ smazán manifest ${repo}:${tag} (${digest})`);
    console.log("  Pro reálné uvolnění místa spusť: registry-cache.mjs gc");
  } else {
    fail(`DELETE ${repo}@${digest} → ${res.status} ${res.statusText}`);
  }
}

async function cmdGc() {
  // GC vyžaduje exec uvnitř registry kontejneru — voláme přes Coolify API.
  // Bez SSH nemáme přímý exec → upozornění + návod.
  console.log("Garbage-collect běží jen v kontejneru (registry:2 nemá HTTP endpoint).");
  console.log("Spusť přes Coolify UI → aisha-registry → Terminal:");
  console.log("  registry garbage-collect /etc/docker/registry/config.yml");
  console.log("nebo přes API exec:");
  const coolifyBase = process.env.COOLIFY_BASE_URL || "$COOLIFY_BASE_URL";
  console.log(
    `  curl -X POST -H "Authorization: Bearer \\$COOLIFY_API_TOKEN" \\\n` +
      `    ${coolifyBase}/api/v1/applications/\\$UUID_REGISTRY/exec \\\n` +
      `    -d '{"command":"registry garbage-collect /etc/docker/registry/config.yml"}'`,
  );
}

const [, , cmd, ...args] = process.argv;
const fn = { ls: cmdLs, stats: cmdStats, rm: () => cmdRm(args[0]), gc: cmdGc }[cmd];

if (!fn) {
  console.log("registry-cache.mjs — správa AISHA pull-through Docker Hub cache");
  console.log("");
  console.log("Použití:");
  console.log("  node scripts/registry-cache.mjs ls");
  console.log("  node scripts/registry-cache.mjs stats");
  console.log("  node scripts/registry-cache.mjs rm <repo>:<tag>");
  console.log("  node scripts/registry-cache.mjs gc");
  process.exit(cmd ? 1 : 0);
}

fn().catch((err) => fail(err.message || String(err)));
