/**
 * Gate (remediation PKI-01-cert-validity): OpenXPKI certificate `notafter`
 * validity offsets must stay within their intended per-plane bounds.
 *
 * Why this exists — the encoding footgun:
 * OpenXPKI relative validity uses the format `+YY[MM[DD[hh[mm[ss]]]]]`, i.e.
 * digits are consumed in *pairs from the left*, and the FIRST pair is YEARS.
 * (The repo's own profile comment states: "+YYMMDD (e.g. +01 = 1 year,
 * +0006 = 6 months)".) This makes short strings dangerous:
 *     "+90"    -> 90 YEARS      (not 90 days!)
 *     "+0001"  -> 0y 1 month    (not 1 day / 24h!)
 *     "+0003"  -> 0y 3 months   (not 3 days!)
 *     "+01"    -> 1 year
 *     "+0006"  -> 6 months
 *
 * Intended bounds (from the profile headers/descriptions in the tree):
 *   - identity/data plane tls_client : short-lived, ~1 year MAX (a 90-year
 *     mTLS backchannel/client cert is effectively non-expiring).
 *   - identity/data plane default    : ~1 year MAX (server certs inherit this).
 *   - orchestration plane default    : server certs "72h auto-renew".
 *   - orchestration plane tls_client : "Short-lived ... (24h)".
 *
 * KNOWN-RED at authoring time (branch feat/remediation):
 *   - openxpki-config/config.d/realm/identity-plane/profile/tls_client.yaml
 *       notafter "+90"   = 90 YEARS  (bound 1y)   <-- miscoded
 *   - openxpki-config/config.d/realm/data-plane/profile/tls_client.yaml
 *       notafter "+90"   = 90 YEARS  (bound 1y)   <-- miscoded
 *   - openxpki-config/config.d/realm/orchestration-plane/profile/default.yaml
 *       notafter "+0003" = 3 MONTHS  (bound 72h)  <-- miscoded (server profile)
 *   - openxpki-config/config.d/realm/orchestration-plane/profile/tls_client.yaml
 *       notafter "+0001" = 1 MONTH   (bound 24h)  <-- miscoded (overlooked sibling)
 *
 * After the fix (recode each offender to the intended magnitude, e.g. the
 * tls_client certs to "+01" / short-lived, orchestration default+client to the
 * hour-scale offsets that actually mean 72h / 24h) this gate goes green.
 * Do NOT relax the bounds table to make the test pass — recode the certs.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "node:fs";

const ROOT = process.cwd();
const REALM_DIR = "openxpki-config/config.d/realm";

const HOURS_PER_DAY = 24;
const HOURS_PER_MONTH = 30 * HOURS_PER_DAY; // OpenXPKI-ish month approximation
const HOURS_PER_YEAR = 365 * HOURS_PER_DAY;

/**
 * Decode an OpenXPKI relative validity offset ("+YYMMDDhhmmss", pairs from the
 * left: years, months, days, hours, minutes, seconds) into an approximate
 * number of hours. Only relative offsets (leading + or -) are handled here;
 * absolute timestamps return null and are skipped by this gate.
 */
function decodeNotafterHours(raw: string): number | null {
  const s = raw.trim();
  const m = /^([+-])(\d+)$/.exec(s);
  if (!m) return null; // absolute date or unexpected shape — not this gate's job
  const digits = m[2];
  // Left-anchored pairs. Odd length is malformed for this format.
  const pairs: number[] = [];
  for (let i = 0; i < digits.length; i += 2) {
    pairs.push(Number(digits.slice(i, i + 2)));
  }
  const [years = 0, months = 0, days = 0, hours = 0, minutes = 0, seconds = 0] = pairs;
  return (
    years * HOURS_PER_YEAR +
    months * HOURS_PER_MONTH +
    days * HOURS_PER_DAY +
    hours +
    minutes / 60 +
    seconds / 3600
  );
}

/** Intended maximum validity per profile file (hours). */
const YEAR = HOURS_PER_YEAR + HOURS_PER_DAY; // 1 year + 1 day slack
const BOUNDS: Record<string, number> = {
  // identity plane — ~1 year certs
  "identity-plane/profile/tls_client.yaml": YEAR,
  "identity-plane/profile/tls_server.yaml": YEAR,
  "identity-plane/profile/default.yaml": YEAR,
  // data plane — ~1 year certs
  "data-plane/profile/tls_client.yaml": YEAR,
  "data-plane/profile/tls_server.yaml": YEAR,
  "data-plane/profile/default.yaml": YEAR,
  // orchestration plane — short-lived service mesh mTLS
  "orchestration-plane/profile/default.yaml": 72, // server certs, "72h auto-renew"
  "orchestration-plane/profile/tls_server.yaml": 72,
  "orchestration-plane/profile/tls_client.yaml": 24, // "Short-lived ... (24h)"
};

/**
 * Conservative fallback for any profile file not explicitly listed above:
 * no legitimate leaf/service cert should outlive 1 year. This makes the gate
 * a true class-scan — a new realm added with a "+90" (90-year) notafter is
 * caught even before anyone updates the bounds table.
 */
const DEFAULT_MAX_HOURS = YEAR;

interface NotafterEntry {
  relPath: string;
  raw: string;
  boundHours: number;
}

/** Scan every profile YAML for a validity.notafter offset. */
function collectNotafterEntries(): NotafterEntry[] {
  const dir = join(ROOT, REALM_DIR);
  if (!existsSync(dir)) return [];
  const files = globSync("**/profile/*.yaml", { cwd: dir });
  const entries: NotafterEntry[] = [];
  for (const rel of files.sort()) {
    const text = readFileSync(join(dir, rel), "utf8");
    // Match `notafter: "+90"` / notafter: +0003 within a validity block.
    // (The profiles carry at most one notafter each.)
    const nm = /^\s*notafter:\s*["']?([+-]?[\w.]+)["']?\s*$/m.exec(text);
    if (!nm) continue;
    const raw = nm[1];
    const boundHours = BOUNDS[rel] ?? DEFAULT_MAX_HOURS;
    entries.push({ relPath: rel, raw, boundHours });
  }
  return entries;
}

const entries = collectNotafterEntries();

describe("PKI-01 OpenXPKI cert validity encoding", () => {
  test("profile tree is present and at least one notafter is scanned", () => {
    expect(existsSync(join(ROOT, REALM_DIR))).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
  });

  test.each(entries)(
    "$relPath notafter $raw is within intended bound",
    ({ relPath, raw, boundHours }) => {
      const hours = decodeNotafterHours(raw);
      // A relative offset must decode; a null here means an unexpected shape
      // that the reviewer must inspect (fail loud rather than skip silently).
      expect(hours, `notafter "${raw}" in ${relPath} is not a decodable relative offset`).not.toBeNull();
      const years = (hours as number) / HOURS_PER_YEAR;
      expect(
        hours as number,
        `${relPath}: notafter "${raw}" decodes to ~${(hours as number).toFixed(0)}h ` +
          `(~${years.toFixed(2)} years) which exceeds the intended max of ${boundHours}h. ` +
          `Remember OpenXPKI offsets are pair-encoded from the left with the FIRST pair = YEARS ` +
          `(e.g. "+90" = 90 years, not 90 days). Recode the cert, do not relax the bound.`,
      ).toBeLessThanOrEqual(boundHours);
    },
  );
});
