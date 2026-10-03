/**
 * pki-db credential-reconcile gate.
 *
 * Incident 2026-07-05: a rotated PKI_DB_PASSWORD left aisha-pki-db stranded on
 * the OLD password (MariaDB only sets passwords on FIRST init; the volume was
 * reused) → OpenXPKI "Database not connected" → pki down → mesh blocked. The fix
 * is a pki-db entrypoint that re-applies the CURRENT env credentials to an
 * existing data dir on every start, so the deploy itself writes the generated
 * value into the stateful backend.
 *
 * This gate guards the wiring + the safety properties of that entrypoint so a
 * refactor cannot silently drop them (the behaviour itself is covered by the
 * docker drift test in the PR, which needs a live MariaDB and cannot run in CI).
 */

import { describe, test, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const DOCKERFILE = join(ROOT, "Dockerfile.pki-db");
const ENTRYPOINT = join(ROOT, "openxpki-config/contrib/pki-db-reconcile-entrypoint.sh");

describe("pki-db credential reconcile", () => {
  test("Dockerfile.pki-db installs + entrypoints the reconcile script", () => {
    const df = readFileSync(DOCKERFILE, "utf8");
    expect(df).toMatch(/COPY[^\n]*pki-db-reconcile-entrypoint\.sh/);
    expect(df).toMatch(/ENTRYPOINT\s*\[\s*"[^"]*pki-db-reconcile-entrypoint\.sh"\s*\]/);
    // must still hand a runnable server command to the stock entrypoint
    expect(df).toMatch(/CMD\s*\[\s*"mariadbd"\s*\]/);
  });

  test("entrypoint exists and is executable", () => {
    expect(existsSync(ENTRYPOINT)).toBe(true);
    // committed with the execute bit so the bind-mount / image both run it
    expect(statSync(ENTRYPOINT).mode & 0o111).not.toBe(0);
  });

  test("entrypoint reconciles safely and hands off to the stock entrypoint", () => {
    const s = readFileSync(ENTRYPOINT, "utf8");
    // first-init safety: skip when the data dir is fresh (stock entrypoint sets it)
    expect(s).toMatch(/\/mysql["'\s\]]/); // guards on ${DATADIR}/mysql existing
    // resets via --init-file (applies with full privileges; no OLD password needed)
    expect(s).toMatch(/--init-file/);
    // must NOT try to run mariadbd as root — data dir is mysql-owned
    expect(s).toMatch(/--user=mysql/);
    // never falls back to skip-grant-tables-as-the-fix (that path silently no-ops)
    expect(s).not.toMatch(/--skip-grant-tables[^\n]*ALTER/);
    // always hands off to the stock entrypoint so first-init / schema still run
    expect(s).toMatch(/exec\s+docker-entrypoint\.sh\s+"\$@"/);
  });

  test("marker records a fingerprint, never the secret value", () => {
    const s = readFileSync(ENTRYPOINT, "utf8");
    // the "separate file" the operator can read is a sha256 fingerprint …
    expect(s).toMatch(/sha256sum/);
    // … and the marker line must be built from fp(...), not the raw password vars
    expect(s).toMatch(/\.pki-db-cred-applied/);
    expect(s).not.toMatch(/>[^\n]*\$\{?MYSQL_(ROOT_)?PASSWORD\}?[^\n]*\.pki-db-cred-applied/);
  });
});
