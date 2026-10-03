/**
 * No Hardcoded Network Gate
 *
 * Zakazuje JAKOUKOLI hardcoded infrastrukturní IP adresu (RFC1918 private ranges
 * 10/8, 172.16/12, 192.168/16) v repozitáři — ať naši (mgmt/backend/experimental
 * LAN) nebo cizí (zákaznické, např. Money/Seyfor S5). Žádné IP adresy v repu:
 * používej mesh DNS (`*.mesh.aisha.internal`), Docker `host-gateway`, placeholder
 * (`<backend-lan-ip>`) nebo env var. Public preview mirror tak neobsahuje žádnou IP —
 * a tento gate sám žádnou konkrétní IP neuvádí (matchuje jen TVAR rozsahů).
 *
 * Cíl: 100% mesh DNS adresace přes `*.mesh.aisha.internal`
 * Detail: docs/deploy/NETBIRD_MESH.md
 *
 * Povolené (NEjsou hardcoded infra host adresy — přeskočeno):
 * - CIDR range bounds (IP následovaná `/` — např. 10.30.0.0/16, 192.168.0.0/16)
 * - RFC5737 dokumentační příklady (192.0.2.x / 198.51.100.x / 203.0.113.x)
 * - loopback / bind-all (127.x, 0.0.0.0) nejsou RFC1918, takže se nematchují vůbec
 *
 * Whitelist cest:
 * - Test mocky / fixtures (SSRF range-vektory, session fixtures)
 * - Archive
 * - Interní security audit (docs/audit/) — vyloučen z public mirroru
 * - .env.*.example placeholders (pro lokální dev)
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");

const SCAN_DIRS = ["src", "services", "scripts", "infra", "coolify", "extensions", "packages", "docs"];
const SCAN_EXTS = new Set([".ts", ".tsx", ".mjs", ".js", ".sh", ".yml", ".yaml", ".json", ".sql", ".md", ".py"]);

const ROOT_FILES_TO_SCAN = (
  fs
    .readdirSync(ROOT)
    .filter((name) => /^docker-compose\..*\.ya?ml$/.test(name) || name === "docker-compose.yml")
);

// Whitelist regex — applied to relative path
const WHITELIST = [
  /^archive\//,
  /\/tests?\//,
  /\/__tests__\//,
  /\.test\./,
  /\.spec\./,
  /\/mocks\//,
  /\/fixtures\//,
  /\/dist\//,
  /\/node_modules\//,
  // Internal security audit — catalogs found IPs; excluded from the public mirror
  /^docs\/audit\//,
  // Generated gate reports echo their own offenders — never self-scan a generated artifact
  /gates-test-report\.json$/,
];

// A valid IPv4 octet (0–255) — keeps version strings / OIDs like 1.15.2.750 from
// matching (750 is not a valid octet).
const OCT = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";

// Any RFC1918 private IPv4 (10/8, 172.16/12, 192.168/16) — the ranges our + any
// customer LAN lives in. No concrete address is written here; only the shape.
const RFC1918 = new RegExp(
  `\\b(?:10(?:\\.${OCT}){3}|172\\.(?:1[6-9]|2\\d|3[01])(?:\\.${OCT}){2}|192\\.168(?:\\.${OCT}){2})\\b`,
  "g",
);

// RFC5737 documentation-example prefixes — allowed placeholders (never RFC1918).
const RFC5737 = /^(?:192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/;

interface Violation {
  file: string;
  line: number;
  ip: string;
  snippet: string;
}

function isWhitelisted(relPath: string): boolean {
  return WHITELIST.some((rx) => rx.test(relPath));
}

// A match is allowed (not a hardcoded infra host) when it is a CIDR range bound
// (immediately followed by `/`) or an RFC5737 documentation example.
function isAllowedMatch(line: string, ip: string, index: number): boolean {
  if (RFC5737.test(ip)) return true;
  if (line[index + ip.length] === "/") return true; // CIDR range bound
  return false;
}

function walk(dir: string, files: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(full, files);
    } else if (SCAN_EXTS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
}

function collectFiles(): string[] {
  const files: string[] = [];
  for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);
  for (const rf of ROOT_FILES_TO_SCAN) files.push(path.join(ROOT, rf));
  return files;
}

function scanFile(absPath: string): Violation[] {
  const relPath = path.relative(ROOT, absPath);
  if (isWhitelisted(relPath)) return [];
  const content = fs.readFileSync(absPath, "utf8");
  const lines = content.split("\n");
  const violations: Violation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    RFC1918.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RFC1918.exec(line)) !== null) {
      const ip = m[0];
      if (isAllowedMatch(line, ip, m.index)) continue;
      violations.push({ file: relPath, line: i + 1, ip, snippet: line.trim().slice(0, 200) });
    }
  }
  return violations;
}

describe("no-hardcoded-network gate — mesh DNS / placeholders only, zero infra IPs", () => {
  const files = collectFiles();
  const allViolations: Violation[] = [];
  for (const f of files) allViolations.push(...scanFile(f));

  it("contains no hardcoded RFC1918 infrastructure IP (ours or a customer's) outside the whitelist", () => {
    expect(
      allViolations,
      allViolations.length
        ? `Hardcoded infra IP(s) found — use mesh DNS / host-gateway / placeholder / env:\n${allViolations
            .map((x) => `  ${x.file}:${x.line}  ${x.ip}  ${x.snippet}`)
            .join("\n")}`
        : "",
    ).toEqual([]);
  });
});
