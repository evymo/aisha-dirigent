/**
 * No real secrets in *.example env templates Gate
 *
 * `.example` / `.env.*.example` files are TEMPLATES — they are tracked and ship
 * publicly. Their secret-shaped fields must be PLACEHOLDERS, never real values.
 *
 * Regression this guards (caught only by the pre-public adversarial secret-scan,
 * NOT by any prior gate): `.env.coolify.example` carried three byte-exact outputs
 * of `scripts/generate-deploy-keys.mjs` on commented-out (`#`) lines — a full
 * HS256 `JWT_SECRET` (mints anon + service_role tokens), the `POSTGRES_PASSWORD`,
 * and the `LOGFLARE_API_KEY`. A leading `#` gives ZERO protection: `git clone` +
 * GitHub code-search recover commented values instantly. The sibling lines used
 * truncated `...` placeholders, so the concrete values were anomalous.
 *
 * This gate fails if any tracked `*.example` file assigns a secret-named key
 * (SECRET / PASSWORD / TOKEN / *_KEY / CREDENTIAL / PRIVATE_KEY) a value that
 * looks like a REAL high-entropy secret (>= 32 chars, base64url/hex charset, no
 * placeholder marker). Commented-out lines are scanned too — `#` is not a shield.
 *
 * Spouští se přes: npm run test:gates
 * @module
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const rel = (p: string): string => p.replace(`${ROOT}/`, "");

/** Recurse the repo, skipping node_modules, .git and the insight submodule. */
function walkExampleFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const p = join(dir, name);
    if (p.includes("/packages/insight")) continue; // separate submodule (own repo)
    const st = statSync(p);
    if (st.isDirectory()) walkExampleFiles(p, out);
    else if (/\.example$/.test(name) || /^\.env\..*\.example$/.test(name)) out.push(p);
  }
  return out;
}

/** A key whose value, if real, is a credential. */
const SECRET_KEY = /(SECRET|PASSWORD|PASSWD|TOKEN|CREDENTIAL|PRIVATE[_-]?KEY)|(_|^)(API[_-]?)?KEY$/i;

/** Markers that prove a value is an intentional placeholder (case-insensitive). */
const PLACEHOLDER = /(<|>|\.\.\.|\byour\b|example|change(_?me)?|generate|placeholder|replace|x{3,}|todo|dummy|sample|redacted|\bhere\b|\$\{|:-)/i;

/** A real-secret-shaped value: long, single-token, high-entropy charset. */
function looksLikeRealSecret(value: string): boolean {
  const v = value.trim().replace(/^["']|["']$/g, "");
  if (v.length < 32) return false;
  if (PLACEHOLDER.test(v)) return false;
  if (!/^[A-Za-z0-9_\-+/=.]+$/.test(v)) return false; // must be a single opaque token
  if ((v.match(/\./g) ?? []).length >= 2) return false; // dotted → domain/path/version, not a secret
  // require real entropy: a mix of cases or digits, not a single repeated/word token
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/].filter((re) => re.test(v)).length;
  return classes >= 2;
}

describe("no real secrets in *.example env templates", () => {
  const files = walkExampleFiles(ROOT);

  test("there are *.example templates to scan (sanity)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test("no *.example file assigns a secret-named key a real secret value", () => {
    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          // tolerate a leading `#` (commented values are still recoverable) and whitespace
          const m = line.match(/^\s*#?\s*([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$/);
          if (!m) return;
          const [, key, value] = m;
          if (!SECRET_KEY.test(key)) return;
          if (looksLikeRealSecret(value)) {
            offenders.push(`${rel(f)}:${i + 1} → ${key}=${value.slice(0, 8)}…(${value.trim().length} chars)`);
          }
        });
    }
    expect(
      offenders,
      `Real-looking secrets in *.example templates (use a <generate …> placeholder instead):\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});
