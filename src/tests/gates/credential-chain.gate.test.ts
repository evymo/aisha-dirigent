/**
 * Credential-chain gate — a credential must be read through the canonical chain.
 *
 * WHY (2026-07-18/19): sixteen separate tools read an operator credential from
 * ONE hardcoded file (`.env-prod-backup`) instead of the shared chain in
 * scripts/lib/config-env-files.mjs. That file is written only once an operator
 * has taken a vault snapshot, so on any stack that has not, the credential is
 * absent — while sitting in .env.coolify, where every other tool finds it.
 *
 * The failures never pointed at the cause. They surfaced as "COOLIFY_API_TOKEN
 * not found", "no project-scoped apps found", "FORGEJO_TOKEN empty",
 * "Reverse-sync failed (stack partially down?)" — each read like a different
 * problem, and one of them silently produced a pre-wipe backup containing ZERO
 * server-side secrets. Two of the sixteen were in the tenant-isolation guard and
 * in cold-start itself, i.e. exactly where a wrong answer is most expensive.
 *
 * Fixing them one at a time did not stop the class from growing, so this gate
 * makes the pipeline refuse instead.
 *
 * DERIVED, NOT LISTED:
 *  - credential names come from TWO derived sources: the operator-input schema
 *    (`secret: true`) and the canonical resolver lib/coolify-credentials.sh,
 *    which names exactly the credentials it exists to resolve. Both are needed —
 *    the schema alone misses COOLIFY_API_TOKEN (declared there as a non-secret
 *    infra endpoint), i.e. the credential behind most of the failures this gate
 *    was written for;
 *  - offenders are found by SHAPE (a credential name read next to a literal
 *    single-file path), never by an allow-list of file names.
 *
 * RATCHET, not hard zero: 12 files still do this today (count MEASURED, see the
 * baseline file). The number may only ever go DOWN — the gate blocks the next
 * one without pretending the repo is already clean.
 */

import { describe, test, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const SCRIPTS = join(ROOT, "scripts");
const BASELINE = join(ROOT, "src/tests/gates/credential-chain.baseline.json");

/** Files that legitimately DEFINE the chain — they must read files directly. */
const CHAIN_IMPLEMENTATIONS = new Set([
  "lib/config-env-files.mjs",
  "lib/coolify-credentials.sh",
]);

function walk(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const abs = join(dir, entry);
    const relPath = rel ? `${rel}/${entry}` : entry;
    if (statSync(abs).isDirectory()) out.push(...walk(abs, relPath));
    else if (/\.(mjs|sh)$/.test(entry)) out.push(relPath);
  }
  return out;
}

async function credentialNames(): Promise<string[]> {
  const names = new Set<string>();

  // Source 1 — the operator-input schema, for everything declared `secret`.
  const mod = await import(pathToFileURL(join(SCRIPTS, "lib/operator-inputs.mjs")).href);
  for (const i of (mod.OPERATOR_INPUTS ?? []) as Array<{ key: string; secret?: boolean }>) {
    if (i.secret && /^[A-Z][A-Z0-9_]*$/.test(i.key)) names.add(i.key);
  }

  // Source 2 — the canonical credential resolver itself. It names exactly the
  // credentials it exists to resolve, so it is the most reliable statement of
  // what counts as one. Needed because the schema alone MISSES the single most
  // important key: COOLIFY_API_TOKEN is declared there as a non-secret infra
  // endpoint, so a schema-only rule silently ignored the credential behind most
  // of the failures this gate was written for. A gate that does not catch its
  // own motivating case is worse than none.
  const resolver = readFileSync(join(SCRIPTS, "lib/coolify-credentials.sh"), "utf8");
  for (const m of resolver.matchAll(/\b(COOLIFY|FORGEJO|VERDACCIO)_[A-Z0-9_]*(TOKEN|KEY|SECRET|PASSWORD)\b/g)) {
    names.add(m[0]);
  }
  return [...names];
}

describe("credential chain", () => {
  test("credential names come from the operator-inputs schema, not this test", async () => {
    const names = await credentialNames();
    expect(names.length).toBeGreaterThan(5);
    // Sanity: the schema is the source, so the tokens this repo actually uses
    // must appear without this file naming them individually.
    expect(names.some((n) => n.includes("COOLIFY"))).toBe(true);
  });

  test("no NEW tool reads a credential from a single hardcoded file", async () => {
    const names = await credentialNames();
    const nameRe = new RegExp(`\\b(${names.join("|")})\\b`);
    // The shape: a literal single-vault path used as a lookup source.
    const singleFileRe = /(\.env-prod-backup|ENV_PROD_BACKUP)/;

    const offenders: string[] = [];
    for (const rel of existsSync(SCRIPTS) ? walk(SCRIPTS) : []) {
      if (CHAIN_IMPLEMENTATIONS.has(rel)) continue;
      const src = readFileSync(join(SCRIPTS, rel), "utf8");
      if (!singleFileRe.test(src)) continue;

      // Only lines that pair a credential with the single-file path are reads of
      // a credential FROM that file; a script may mention the vault for other
      // reasons (writing it, snapshotting it, documenting it).
      // A READ, not a mention. The vault path legitimately appears in comments
      // and in error messages that name the search path — flagging those trains
      // people to ignore the gate, so the shape must be an ASSIGNMENT whose
      // value is extracted from that file: `X=$(grep ... "$VAULT")`,
      // `read_env_key "K" "$VAULT"`, or a JS read of the same.
      const lines = src.split(/\r?\n/);
      // Any command substitution or helper that EXTRACTS from the file. Written
      // broadly on purpose: `X=$(grep …)`, `X="${Y:-$(grep …)}"` and
      // `read_env_key K "$VAULT"` are all the same act, and an over-narrow shape
      // produced a false NEGATIVE on the second form while I was writing this.
      const readShape = /(\$\(|read_env_key|backup_env_value|readFileSync)/;
      const hits = lines.filter(
        (l) =>
          singleFileRe.test(l) &&
          nameRe.test(l) &&
          readShape.test(l) &&
          !/^\s*(#|\/\/|\*)/.test(l) &&
          // not an error/usage string that merely names the file
          !/(console\.(error|warn)|echo|printf|err\s|fatal\()/.test(l),
      );
      if (hits.length) offenders.push(`${rel} (${hits.length})`);
    }

    const baseline = existsSync(BASELINE)
      ? (JSON.parse(readFileSync(BASELINE, "utf8")).single_file_credential_reads as number)
      : 0;

    expect(
      offenders.length,
      `credential read from a single hardcoded vault path instead of ` +
        `scripts/lib/config-env-files.mjs:\n  ${offenders.join("\n  ")}\n` +
        `baseline=${baseline}. This count may only go DOWN — route the lookup ` +
        `through readConfigKey() / config_env_key() and lower the baseline.`,
    ).toBeLessThanOrEqual(baseline);
  });
});
