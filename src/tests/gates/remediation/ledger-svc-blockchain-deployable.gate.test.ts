/**
 * REMEDIATION GATE — LEDGER-01: svc-blockchain must be actually DEPLOYABLE,
 * not merely referenced by a URL env var.
 *
 * CONTRACT
 * --------
 * `svc-blockchain` (the Node.js on-chain dispatcher, port 3013 — src/server.ts:
 * routes dispatch / record-audit / ledger-sync / gov-read / claim-reward /
 * governance-vote; broadcasts via cosmjs SigningStargateClient) is the ONLY
 * thing that drains the blockchain outbox (retry_pending_blockchain_syncs.sql →
 * RabbitMQ → WF_BLOCKCHAIN_SYNC → /ledger-sync). If it is never deployed, the
 * outbox fills forever and nothing is ever anchored on-chain.
 *
 * For the service to actually run on a fork / cold-start it must be BOTH:
 *
 *   (A) declared as a real Compose SERVICE (a `svc-blockchain:` service block,
 *       or a service whose container_name / network alias is `svc-blockchain`)
 *       carrying a `build:` or `image:` directive, in some `docker-compose*.yml`.
 *       A dangling `SVC_BLOCKCHAIN_URL` env is NOT a deployment — it just names
 *       a host that nothing brings up.
 *
 *   (B) catalogued in `config/services.json` under `services`, with a dedicated
 *       entry for the dispatcher (key `svc-blockchain` or a role containing
 *       "blockchain"). The Cosmos validator (`ledger`, role "ledger") is a
 *       DIFFERENT thing — it is the chain node, not the dispatcher — so it does
 *       not satisfy this. Without a catalog entry the topology resolver
 *       (derive-domains.mjs) and the coolify-story provisioner never emit /
 *       create the app.
 *
 * KNOWN-RED (the reason this gate exists):
 *   - docker-compose.coolify.yml:343 has only
 *       `SVC_BLOCKCHAIN_URL: http://svc-blockchain:3013`
 *     — a plain env value. NO `docker-compose*.yml` declares a `svc-blockchain`
 *     SERVICE with a build/image block (violates A).
 *   - config/services.json catalogues only the Cosmos `ledger` node
 *     (services.json:212-221); there is NO `svc-blockchain` dispatcher entry
 *     (violates B).
 *   => On a fork the outbox fills but nothing dispatches. Expect RED.
 *
 * This is a STATIC SoT-scanning gate: it walks every `docker-compose*.yml` and
 * parses `config/services.json` offline — deterministic, no new deps.
 *
 * Run:
 *   AISHA_SKIP_ONLINE=1 npx vitest run --config vitest.gates.config.ts \
 *     src/tests/gates/remediation/ledger-svc-blockchain-deployable.gate.test.ts
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const SERVICE_HOST = "svc-blockchain";

/** Every docker-compose*.yml at the repo root. */
function composeFiles(): string[] {
  return fs
    .readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter(
      (e) =>
        e.isFile() &&
        /^docker-compose.*\.ya?ml$/.test(e.name),
    )
    .map((e) => path.join(REPO_ROOT, e.name))
    .sort();
}

/**
 * Parse the `services:` mapping of a compose file into { name -> body-text }.
 * Service keys are the 2-space-indented keys directly under a top-level
 * `services:` line; a body runs until the next 2-space-indented key or the next
 * top-level (0-indent) key. Indentation-based, no YAML dep.
 */
function extractServiceBlocks(content: string): Map<string, string> {
  const lines = content.split(/\r?\n/);
  const blocks = new Map<string, string>();
  let inServices = false;
  let currentName: string | null = null;
  let currentBody: string[] = [];

  const flush = () => {
    if (currentName !== null) {
      blocks.set(currentName, currentBody.join("\n"));
    }
    currentName = null;
    currentBody = [];
  };

  for (const line of lines) {
    // Ignore blank / comment-only lines for structural decisions.
    const isBlankOrComment = /^\s*(#.*)?$/.test(line);

    if (!inServices) {
      if (/^services:\s*(#.*)?$/.test(line)) inServices = true;
      continue;
    }

    // A new top-level key (0 indent, non-space first char) ends the services map.
    if (!isBlankOrComment && /^[^\s#]/.test(line)) {
      flush();
      inServices = false;
      continue;
    }

    // A 2-space-indented `name:` starts a new service block.
    const svcKey = line.match(/^ {2}([A-Za-z0-9._-]+):\s*(#.*)?$/);
    if (svcKey) {
      flush();
      currentName = svcKey[1];
      continue;
    }

    if (currentName !== null) currentBody.push(line);
  }
  flush();
  return blocks;
}

/** True if a service block carries a `build:` or `image:` directive. */
function hasBuildOrImage(body: string): boolean {
  return /^\s*build:\s*/m.test(body) || /^\s*image:\s*/m.test(body);
}

/** True if this block IS the svc-blockchain service (by name, container_name,
 * or network alias). */
function isBlockchainService(name: string, body: string): boolean {
  if (name === SERVICE_HOST) return true;
  if (new RegExp(`container_name:\\s*.*${SERVICE_HOST}\\b`).test(body)) {
    return true;
  }
  // A network alias line exactly naming the host.
  if (new RegExp(`^\\s*-\\s*${SERVICE_HOST}\\s*$`, "m").test(body)) return true;
  return false;
}

interface CatalogEntry {
  role?: string;
  compose?: string;
  [k: string]: unknown;
}

describe("LEDGER-01 — svc-blockchain is actually deployable", () => {
  const files = composeFiles();

  it("repo has docker-compose files to scan", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  // (A) A real Compose SERVICE with a build/image block.
  it("some docker-compose*.yml declares a svc-blockchain SERVICE with build/image", () => {
    const matches: string[] = [];
    for (const f of files) {
      const content = fs.readFileSync(f, "utf8");
      const blocks = extractServiceBlocks(content);
      for (const [name, body] of blocks) {
        if (isBlockchainService(name, body) && hasBuildOrImage(body)) {
          matches.push(`${path.basename(f)} :: service '${name}'`);
        }
      }
    }
    expect(
      matches,
      `No docker-compose*.yml declares 'svc-blockchain' as a runnable SERVICE ` +
        `(a service block named svc-blockchain — or whose container_name/alias ` +
        `is svc-blockchain — carrying a build: or image: directive). Today only ` +
        `the env 'SVC_BLOCKCHAIN_URL: http://svc-blockchain:3013' exists ` +
        `(docker-compose.coolify.yml:343), which names a host nothing brings up. ` +
        `The blockchain outbox has no dispatcher — add a build/image service ` +
        `block (mirror the coolify-ai-chat sibling-stack pattern).`,
    ).not.toEqual([]);
  });

  // (B) A dedicated catalog entry in config/services.json.
  it("config/services.json catalogues a svc-blockchain dispatcher entry (not just the cosmos 'ledger' node)", () => {
    const catalogPath = path.join(REPO_ROOT, "config/services.json");
    const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as {
      services?: Record<string, CatalogEntry>;
    };
    const services = catalog.services ?? {};

    const hits = Object.entries(services).filter(([key, entry]) => {
      const role = String(entry?.role ?? "").toLowerCase();
      // The dispatcher: keyed svc-blockchain, or a role/compose referencing the
      // blockchain dispatcher. Exclude the cosmos validator (role 'ledger').
      if (role === "ledger") return false;
      if (key === SERVICE_HOST) return true;
      if (/blockchain/.test(key.toLowerCase())) return true;
      if (/blockchain/.test(role)) return true;
      if (/svc-blockchain/.test(String(entry?.compose ?? "").toLowerCase())) {
        return true;
      }
      return false;
    });

    expect(
      hits.map(([k]) => k),
      `config/services.json has no catalog entry for the svc-blockchain ` +
        `dispatcher. Today only the Cosmos validator ('ledger', role 'ledger', ` +
        `services.json:212-221) is catalogued — that is the chain NODE, not the ` +
        `dispatcher that drains the outbox. Add a 'svc-blockchain' service entry ` +
        `so the topology resolver / coolify provisioner create the app on a fork.`,
    ).not.toEqual([]);
  });
});
