#!/usr/bin/env node
/**
 * Dynamic host-port allocator — makes local deploy + tests unbreakable against
 * port conflicts on a shared machine.
 *
 * WHY: this box runs many parallel projects. Foreign containers (e.g. pg16-host
 * on :5433) squat on ports our stack prefers. We must NEVER free a port by
 * touching another project's container — instead we pick a free port and make
 * the whole stack consume it. The var names below are exactly what the compose
 * files (docker-compose.e2e.yml: ${E2E_DB_PORT} etc.), _platform (${POSTGRES_PORT}),
 * and the db scripts (${AISHA_LOCAL_DB_URL}) already read — so wiring is just
 * "source .env.ports".
 *
 * Allocation rule per logical port:
 *   1. If our OWN running container already publishes the preferred port → keep
 *      it (idempotent — re-running never churns a live stack).
 *   2. Else if the preferred port is free → take it.
 *   3. Else scan upward from preferred until a free port is found.
 *
 * Output (single source of truth, git-ignored):
 *   scripts/local/.env.ports        — `NAME=value` lines (ports + derived URLs);
 *                                     `set -a; source .env.ports; set +a` in up.sh
 *   scripts/local/.stack-ports.json — resolved ports, for programmatic reads (tests)
 *
 * Usage:
 *   node scripts/local/ports.mjs                  # allocate, write outputs, print table
 *   node scripts/local/ports.mjs --json           # print resolved port map as JSON
 *   node scripts/local/ports.mjs --get E2E_DB_PORT # print one resolved port
 *   eval "$(node scripts/local/ports.mjs --export)" # export into the current shell
 *
 * @module
 */

import net from "node:net";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "../lib/cli-entry.mjs";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV_OUT = path.join(HERE, ".env.ports");
const JSON_OUT = path.join(HERE, ".stack-ports.json");

/**
 * The stack's logical host ports, keyed by the EXACT env-var name the compose /
 * scripts already read. `preferred` is the historical/nice port; `container` is
 * the name of OUR container that publishes it (idempotent-reuse check).
 * `hostProcMatch` (optional) is for entries with NO container — a host process
 * such as the Vite dev SPA: a command-line pattern (with `<preferred>`
 * substituted for the port) used to recognise OUR OWN listener, so a re-run
 * reuses its port instead of drifting off it. `docker ps` can't see host
 * processes, so this closes the gap for them. Add a service here — nothing
 * else changes.
 */
const REGISTRY = [
  // AISHA e2e stack (docker-compose.e2e.yml uses these names)
  { name: "E2E_DB_PORT", preferred: 57422, container: "aisha-db" },
  { name: "E2E_GATEWAY_PORT", preferred: 57421, container: "aisha-gateway" },
  { name: "E2E_KC_PORT", preferred: 8080, container: "aisha-keycloak" },
  { name: "E2E_WEB_PORT", preferred: 4173, container: null, hostProcMatch: "vite --port <preferred>" }, // vite dev (host process)
  { name: "APPSMITH_PORT", preferred: 8084, container: "aisha-appsmith" },
  { name: "E2E_N8N_PORT", preferred: 5678, container: "aisha-n8n-local" }, // n8n standalone (docker run bypass)
  // Federační ZDROJOVÝ stack — jeho kontejnery patří instanci, ne platformě,
  // takže se jejich jména deklarují v prostředí. Nedeklarovaná = položka se
  // přeskočí: instalace bez cizího zdrojového systému ho nemá kde hledat.
  ...(process.env.SOURCE_STACK_DB_CONTAINER
    ? [{ name: "POSTGRES_PORT", preferred: 5433, container: process.env.SOURCE_STACK_DB_CONTAINER }]
    : []),
  ...(process.env.SOURCE_STACK_API_CONTAINER
    ? [{ name: "SOURCE_API_PORT", preferred: 8002, container: process.env.SOURCE_STACK_API_CONTAINER }]
    : []),
];

/**
 * Derived vars built from the resolved ports — the URL-shaped env the db
 * scripts + the SPA already consume, so they follow the dynamic ports for free.
 * @param {Record<string, number>} p resolved port map
 */
const derive = (p) => ({
  AISHA_LOCAL_DB_URL: `postgresql://postgres:postgres@127.0.0.1:${p.E2E_DB_PORT}/postgres`,
  VITE_AISHA_GATEWAY_URL: `http://127.0.0.1:${p.E2E_GATEWAY_PORT}`,
  VITE_KC_URL: `http://127.0.0.1:${p.E2E_KC_PORT}`,
});

/** True if a TCP port is bindable (== free) on 0.0.0.0 (most conservative). */
function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "0.0.0.0");
  });
}

/**
 * docker ps → { byPort: Map(hostPort → containerName), byName: Map(name → hostPort) }
 * for published ports only. `byName` records the FIRST published host port a
 * container exposes — used so we reuse OUR live container's ACTUAL port even if
 * it drifted off its preferred (e.g. an aisha-keycloak left on :18080 from a
 * prior manual run). Without this, compose would try to rebind the preferred
 * port and hit a "container name already in use" conflict.
 */
function dockerPublishedPorts() {
  const byPort = new Map();
  const byName = new Map();
  try {
    const out = execFileSync("docker", ["ps", "--format", "{{.Names}}\t{{.Ports}}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
    });
    for (const line of out.split("\n")) {
      const [name, ports] = line.split("\t");
      if (!name || !ports) continue;
      for (const m of ports.matchAll(/(?:^|,\s*)(?:[\d.]+:)?(\d+)->/g)) {
        const hp = Number(m[1]);
        byPort.set(hp, name);
        if (!byName.has(name)) byName.set(name, hp);
      }
    }
  } catch (err) {
    console.warn('[ports] docker ps unreachable; treating as no published ports:', err?.message ?? err);
  }
  return { byPort, byName };
}

/**
 * For a host-process registry entry (no docker container — e.g. the Vite dev
 * SPA), decide whether the process currently LISTENing on `port` is OUR OWN
 * service, by matching its command line against `pattern`. Lets the allocator
 * reuse a preferred port that our own long-running host process still holds
 * across a re-run — `docker ps` can't see host processes, so without this the
 * allocator treats the port as a foreigner's and needlessly drifts off it
 * (forcing an SPA restart + .env.local rewrite + Keycloak redirect-URI update).
 *
 * `pattern` is whitespace-tokenised and ALL tokens must appear in the command
 * (order-independent), so "vite --port 4173" matches
 * `node …/node_modules/.bin/vite --port 4173 --strictPort` yet stays strict
 * enough to reject an unrelated process that merely happens to hold the port.
 *
 * Dependency-free (macOS `lsof` + `ps`). FAIL-OPEN: any error, missing tool, or
 * absent listener → false, so the caller falls back to the normal scan-upward.
 * It never yields a false "it's ours".
 *
 * @param {number} port host port to inspect
 * @param {string} pattern space-separated tokens required in the listener's cmd
 * @returns {boolean} true only if a matching process is listening on `port`
 */
function hostProcessMatches(port, pattern) {
  const tokens = pattern.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  try {
    const pids = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const pid of pids) {
      let cmd;
      try {
        cmd = execFileSync("ps", ["-p", pid, "-o", "command="], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5000,
        }).trim();
      } catch (err) {
        console.warn('[ports] ps failed for pid (likely vanished between lsof and ps); skipping:', err?.message ?? err);
        continue;
      }
      if (tokens.every((t) => cmd.includes(t))) return true;
    }
  } catch (err) {
    console.warn('[ports] lsof unavailable/no listener/timeout; failing open (treating as not ours):', err?.message ?? err);
  }
  return false;
}

/**
 * Resolve the whole registry to concrete free ports.
 * @returns {Promise<Record<string, number>>}
 */
export async function allocateStackPorts() {
  const { byPort: published, byName: ourPortByName } = dockerPublishedPorts();
  const chosen = {};
  const taken = new Set();

  for (const { name, preferred, container, hostProcMatch } of REGISTRY) {
    // (1a) our named container is live and publishes a host port → reuse THAT
    //      port (even if it drifted off `preferred`). Prevents a compose
    //      recreate from fighting the live container for the preferred port.
    const livePort = container ? ourPortByName.get(container) : undefined;
    if (livePort != null) {
      chosen[name] = livePort;
      taken.add(livePort);
      continue;
    }
    // (1b) our own live container already holds the preferred port — reuse.
    const holder = published.get(preferred);
    if (holder && container && holder === container) {
      chosen[name] = preferred;
      taken.add(preferred);
      continue;
    }
    // (1c) host-process entry (no container) whose preferred port is currently
    //      held by OUR OWN host process (e.g. the Vite dev SPA). `docker ps`
    //      can't attribute a host process to us, so match the listener's command
    //      line via `hostProcMatch`; if it's ours, reuse the port instead of
    //      drifting (which would churn the SPA restart + .env.local + KC
    //      redirect URIs). Guarded so we never override a port another entry
    //      already took or a docker container publishes; fail-open by design.
    if (container == null && hostProcMatch && !taken.has(preferred) && !published.has(preferred)) {
      const pat = hostProcMatch.replaceAll("<preferred>", String(preferred));
      if (hostProcessMatches(preferred, pat)) {
        chosen[name] = preferred;
        taken.add(preferred);
        continue;
      }
    }
    // (2)/(3) scan for a free port (skip ports taken this run + any published port).
    let p = preferred;
    while (taken.has(p) || published.has(p) || !(await isPortFree(p))) {
      p += 1;
      if (p > preferred + 500) throw new Error(`No free port near ${preferred} for ${name}`);
    }
    chosen[name] = p;
    taken.add(p);
  }
  return chosen;
}

/** Persist ports + derived vars to .env.ports + .stack-ports.json. */
function writeOutputs(ports) {
  const all = { ...ports, ...derive(ports) };
  const header =
    "# AUTO-GENERATED by scripts/local/ports.mjs — dynamic free-port allocation.\n" +
    "# Do NOT edit; do NOT commit. Consume with: set -a; source scripts/local/.env.ports; set +a\n";
  writeFileSync(
    ENV_OUT,
    header + Object.entries(all).map(([k, v]) => `${k}=${v}`).join("\n") + "\n",
  );
  writeFileSync(JSON_OUT, JSON.stringify(ports, null, 2) + "\n");
  return all;
}

/** Read one resolved port (allocating defaults if the file is missing). */
export function getStackPort(name) {
  if (existsSync(JSON_OUT)) {
    const map = JSON.parse(readFileSync(JSON_OUT, "utf8"));
    if (map[name] != null) return Number(map[name]);
  }
  return REGISTRY.find((e) => e.name === name)?.preferred;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const isMain = isDirectRun(import.meta.url);
if (isMain) {
  const getIdx = process.argv.indexOf("--get");
  if (getIdx !== -1) {
    process.stdout.write(String(getStackPort(process.argv[getIdx + 1]) ?? "") + "\n");
  } else {
    const ports = await allocateStackPorts();
    const all = writeOutputs(ports);
    if (process.argv.includes("--json")) {
      process.stdout.write(JSON.stringify(ports) + "\n");
    } else if (process.argv.includes("--export")) {
      process.stdout.write(Object.entries(all).map(([k, v]) => `export ${k}='${v}'`).join("\n") + "\n");
    } else {
      const rows = REGISTRY.map((e) => {
        const got = ports[e.name];
        const note = got === e.preferred ? "" : `  ⟵ preferred ${e.preferred} taken`;
        return `  ${e.name.padEnd(18)} ${String(got).padEnd(6)}${note}`;
      });
      process.stderr.write(
        "✓ allocated stack ports → scripts/local/.env.ports\n" +
          rows.join("\n") +
          `\n  (+ derived AISHA_LOCAL_DB_URL, VITE_AISHA_GATEWAY_URL, VITE_KC_URL)\n`,
      );
    }
  }
}
