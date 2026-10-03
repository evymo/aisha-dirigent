/**
 * Gate: pki-ca-bundle-system-merge
 *
 * Guards the regression that crash-looped grafana-auth (oauth2-proxy) on a
 * fresh deploy: a service pointed its TLS trust store at the AISHA private CA
 * bundle (`/certs/pki/aisha-ca-bundle.pem`) via a CA-*REPLACING* mechanism, but
 * the stack's `pki-init` only staged the AISHA roots — it never merged the
 * system CA bundle (`/etc/ssl/certs/ca-certificates.crt`). The container then
 * could not verify the public Let's Encrypt cert on the OIDC discovery
 * endpoint (auth.aisha.guru) and crash-looped on startup.
 *
 * The fix (commit f8d24e5f) made observability's pki-init concatenate the
 * system bundle:
 *   cat /staging/aisha-ca-bundle.pem /etc/ssl/certs/ca-certificates.crt > .../aisha-ca-bundle.pem
 *
 * This gate makes that contract permanent and applies it to every stack.
 *
 * The rule — per Coolify compose file:
 *   IF any service sets a CA-REPLACING env var (e.g. OAUTH2_PROXY_PROVIDER_CA_FILES,
 *   SSL_CERT_FILE, CURL_CA_BUNDLE, REQUESTS_CA_BUNDLE, *_CA_FILE/_CA_FILES)
 *   pointing at the AISHA pki bundle,
 *   THEN the stack's pki-init command MUST merge /etc/ssl/certs/ca-certificates.crt
 *   into that bundle.
 *
 * Append-style mechanisms are explicitly exempt:
 *   - NODE_EXTRA_CA_CERTS — Node.js ADDS these certs to the system pool, it does
 *     not replace it, so the public LE roots remain trusted even with an
 *     AISHA-only bundle. (Used by langfuse / llm-gateway / openclaw.)
 *
 * Why a gate and not a one-off fix: 8 stacks ship a pki-init and 4 already
 * redirect TLS verification at the AISHA bundle. The next stack that adds an
 * oauth2-proxy / Go service with PROVIDER_CA_FILES would silently re-introduce
 * the exact crash-loop. This catches it at PR time, not at cold-start time.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();

/** CA env vars that REPLACE the entire system trust store. */
const CA_REPLACING_VARS = [
  "OAUTH2_PROXY_PROVIDER_CA_FILES",
  "SSL_CERT_FILE",
  "CURL_CA_BUNDLE",
  "REQUESTS_CA_BUNDLE",
  "GIT_SSL_CAINFO",
];
/** Generic suffix match for "*_CA_FILE" / "*_CA_FILES" replace-style vars. */
const CA_REPLACING_SUFFIX = /^[A-Z0-9_]+_CA_FILES?$/;
/** CA env vars that APPEND to the system trust store (system roots stay trusted). */
const CA_APPENDING_VARS = new Set(["NODE_EXTRA_CA_CERTS"]);

/** A value is "the AISHA private bundle" if it lives under the pki cert mount. */
function pointsAtAishaBundle(value: string): boolean {
  return value.includes("/certs/pki/") || value.includes("aisha-ca-bundle");
}

/** List all Coolify compose files in the repo root. */
function listComposeFiles(): string[] {
  return fs
    .readdirSync(ROOT)
    .filter((f) => /^docker-compose\.coolify-.*\.yml$/.test(f))
    .map((f) => path.join(ROOT, f));
}

/**
 * Find env vars that redirect TLS verification at the AISHA bundle via a
 * REPLACING mechanism. Returns the list of "VAR_NAME" matches (empty if none).
 *
 * Matches both `KEY: value` and `KEY=value` env forms used across compose
 * files. Append-style vars (NODE_EXTRA_CA_CERTS) are ignored on purpose.
 */
function findReplacingCaOverrides(content: string): string[] {
  const found: string[] = [];
  // KEY[:=] value  — capture the env key and its (rest-of-line) value.
  const envLine = /^\s*-?\s*([A-Z][A-Z0-9_]*)\s*[:=]\s*(\S.*?)\s*$/gm;
  for (const m of content.matchAll(envLine)) {
    const key = m[1];
    const value = m[2];
    if (CA_APPENDING_VARS.has(key)) continue;
    const isReplacing = CA_REPLACING_VARS.includes(key) || CA_REPLACING_SUFFIX.test(key);
    if (isReplacing && pointsAtAishaBundle(value)) {
      found.push(key);
    }
  }
  return found;
}

/** The `pki-certs:` block from a compose file's top-level volumes section. */
function pkiCertsVolumeBlock(content: string): string | null {
  const m = content.match(/^ {2}pki-certs:\n((?: {4}.*\n)*)/m);
  return m ? m[1] : null;
}

/** True if THIS file's pki-init merges the system store (inline or via script). */
function fileHasMergingPkiInit(content: string): boolean {
  if (!/^\s{2,}pki-init:/m.test(content)) return false;
  if (/ca-certificates\.crt/.test(content)) return true;
  if (/assemble-ca-bundle\.sh/.test(content)) {
    const script = fs.readFileSync(path.join(ROOT, "infra/pki/assemble-ca-bundle.sh"), "utf8");
    return /ca-certificates\.crt/.test(script);
  }
  return false;
}

/**
 * Returns true if the stack's AISHA bundle provably contains the system CAs.
 *
 * The merge guarantee lives in one of three places:
 *   1. Inline: this file's pki-init runs
 *      `cat ... /etc/ssl/certs/ca-certificates.crt ... > .../bundle`.
 *   2. Delegated: this file's pki-init calls the baked
 *      /usr/local/bin/assemble-ca-bundle.sh, which starts the bundle from the
 *      system store before appending the AISHA realm CAs. We follow the
 *      delegation and confirm the SCRIPT does the merge — a script that forgot
 *      it still fails this gate, so the guarantee holds.
 *   3. Consumer of a shared volume: the stack has NO pki-init and mounts the
 *      bundle from an `external: true` pki-certs volume (aisha-edge mounts the
 *      core stack's `aisha_v2_pki-certs`). We follow the volume NAME to the
 *      producing compose (the one declaring the same name WITHOUT
 *      external: true) and require THE PRODUCER's pki-init to merge — a
 *      producer that forgot still fails this gate for every consumer.
 */
function pkiInitMergesSystemCa(content: string): boolean {
  if (/^\s{2,}pki-init:/m.test(content)) return fileHasMergingPkiInit(content);

  // Consumer-only stack: follow the external pki-certs volume to its producer.
  const block = pkiCertsVolumeBlock(content);
  if (!block || !/external:\s*true/.test(block)) return false;
  const nameMatch = block.match(/name:\s*(\S+)/);
  if (!nameMatch) return false;
  const volumeName = nameMatch[1];

  for (const f of fs.readdirSync(ROOT).filter((f) => /^docker-compose\..*\.yml$/.test(f))) {
    const producer = fs.readFileSync(path.join(ROOT, f), "utf8");
    const producerBlock = pkiCertsVolumeBlock(producer);
    if (!producerBlock || /external:\s*true/.test(producerBlock)) continue;
    if (!new RegExp(`name:\\s*${volumeName}\\s*$`, "m").test(producerBlock)) continue;
    return fileHasMergingPkiInit(producer);
  }
  return false;
}

describe("gate: pki-ca-bundle-system-merge", () => {
  const composeFiles = listComposeFiles();

  it("finds Coolify compose files to scan", () => {
    expect(composeFiles.length).toBeGreaterThan(0);
  });

  it("every stack that REPLACES the system CA with the AISHA bundle merges system CAs in pki-init", () => {
    const violations: string[] = [];

    for (const file of composeFiles) {
      const content = fs.readFileSync(file, "utf8");
      const overrides = findReplacingCaOverrides(content);
      if (overrides.length === 0) continue; // no CA-replacing service here

      if (!pkiInitMergesSystemCa(content)) {
        const rel = path.basename(file);
        violations.push(
          `${rel}: redirects TLS verification at the AISHA bundle via ${overrides.join(", ")} ` +
            `but its pki-init does NOT merge /etc/ssl/certs/ca-certificates.crt. ` +
            `Public certs (Let's Encrypt OIDC endpoints) will fail to verify and the ` +
            `container will crash-loop. Fix: pki-init command must ` +
            `'cat <aisha-bundle> /etc/ssl/certs/ca-certificates.crt > <bundle>'.`,
        );
      }
    }

    expect(
      violations,
      `CA-replacing stacks missing system-CA merge:\n  - ${violations.join("\n  - ")}`,
    ).toEqual([]);
  });
});
