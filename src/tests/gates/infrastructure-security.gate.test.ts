/**
 * Infrastructure Security Gate Tests
 *
 * Static analysis of Docker Compose files and shell scripts
 * to detect common infrastructure security anti-patterns.
 *
 * Categories:
 * 1. Elasticsearch without xpack.security
 * 2. Compose fallback secrets that are weak / placeholder
 * 3. VERIFY_JWT disabled by default
 * 4. Privileged DB roles used by application services
 * 5. Services missing healthcheck definitions
 * 6. Shell scripts with unsafe password handling
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, test, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const COOLIFY_DIR = join(ROOT, "coolify");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readSafe(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

/** Get all docker-compose*.yml files from project root. */
function getComposeFiles(): { path: string; relPath: string; content: string }[] {
  const files: { path: string; relPath: string; content: string }[] = [];
  if (!existsSync(ROOT)) return files;
  for (const name of readdirSync(ROOT)) {
    if (name.startsWith("docker-compose") && name.endsWith(".yml")) {
      const fullPath = join(ROOT, name);
      files.push({
        path: fullPath,
        relPath: name,
        content: readSafe(fullPath),
      });
    }
  }
  return files;
}

// Load all compose files once
const COMPOSE_FILES = getComposeFiles();
const DB_WRAPPER = readSafe(join(COOLIFY_DIR, "db-entrypoint-wrapper.sh"));

// ─── 2. Compose: Security defaults ──────────────────────────────────────────

describe("Docker Compose Security Defaults", () => {
  test("VERIFY_JWT must not default to false", () => {
    const violations: string[] = [];

    for (const file of COMPOSE_FILES) {
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match patterns like VERIFY_JWT: ${..:-false} or VERIFY_JWT: "false" or VERIFY_JWT: false
        if (/VERIFY_JWT.*:-\s*false/i.test(line) || /VERIFY_JWT:\s*["']?false["']?\s*$/i.test(line)) {
          violations.push(`${file.relPath}:${i + 1} — VERIFY_JWT defaults to false`);
        }
      }
    }

    expect(
      violations,
      "VERIFY_JWT must default to true for production safety:\n" + violations.join("\n"),
    ).toEqual([]);
  });

  test("Elasticsearch must have xpack.security enabled", () => {
    const violations: string[] = [];

    for (const file of COMPOSE_FILES) {
      // Local dev compose is exempt — ES runs without security locally
      if (file.relPath.includes("local")) continue;

      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (
          /xpack\.security\.enabled.*["']?false["']?/i.test(line)
        ) {
          violations.push(`${file.relPath}:${i + 1} — xpack.security.enabled is false`);
        }
      }
    }

    expect(
      violations,
      "Elasticsearch xpack.security must be enabled:\n" + violations.join("\n"),
    ).toEqual([]);
  });

  test("no privileged DB roles (aisha_admin, postgres superuser) in application service DATABASE_URL", () => {
    const violations: string[] = [];

    // Privileged roles that should NOT appear in app service connection strings
    const PRIVILEGED_ROLES = ["aisha_admin", "postgres"];

    // Services that legitimately use aisha_admin (DB management, migrations)
    const ADMIN_SERVICE_PATTERNS = [
      "migrate",
      "studio",
      "analytics",
      "meta",
      "logflare",
    ];

    for (const file of COMPOSE_FILES) {
      // Local dev compose is exempt — simplified credentials for development
      if (file.relPath.includes("local")) continue;

      const lines = file.content.split("\n");
      let currentService = "";

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Track current service name
        const svcMatch = line.match(/^\s{2}(\S+):/);
        if (svcMatch && !line.includes("environment") && !line.includes("-")) {
          currentService = svcMatch[1];
        }

        // Check DATABASE_URL for privileged roles
        for (const role of PRIVILEGED_ROLES) {
          const pattern = new RegExp(
            `DATABASE_URL.*://\\s*${role}:`,
            "i",
          );
          if (pattern.test(line)) {
            // Check if this is a legitimately admin service
            const isAdmin = ADMIN_SERVICE_PATTERNS.some((p) =>
              currentService.toLowerCase().includes(p),
            );
            if (!isAdmin) {
              violations.push(
                `${file.relPath}:${i + 1} — service "${currentService}" uses privileged role "${role}" in DATABASE_URL`,
              );
            }
          }
        }
      }
    }

    expect(
      violations,
      "Application services must use dedicated DB roles, not aisha_admin:\n" +
        violations.join("\n"),
    ).toEqual([]);
  });

  test("compose services must have healthcheck definitions", () => {
    const violations: string[] = [];

    for (const file of COMPOSE_FILES) {
      // Skip local-only compose
      if (file.relPath.includes("local")) continue;

      // Extract service names from the services: section only (not volumes/networks)
      const lines = file.content.split("\n");
      let inServices = false;
      const serviceNames: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Top-level key (no indentation) — track which section we're in
        if (/^[a-z][\w-]*:/i.test(line) && !line.startsWith(" ")) {
          inServices = /^services:/.test(line);
          continue;
        }
        if (inServices) {
          // Service names are at exactly 2-space indent
          const svcMatch = line.match(/^ {2}([a-zA-Z][\w-]*):/);
          if (svcMatch) {
            serviceNames.push(svcMatch[1]);
          }
        }
      }

      for (const name of serviceNames) {
        const svcBlock = extractServiceBlock(file.content, name);
        if (!svcBlock) continue;

        // Init containers (restart: "no") don't need healthcheck
        if (/restart:\s*["']?no["']?/.test(svcBlock)) continue;

        if (!svcBlock.includes("healthcheck")) {
          // Check if service inherits healthcheck via YAML anchor (<<: *anchor)
          const anchorRef = svcBlock.match(/<<:\s*\*(\S+)/);
          if (anchorRef) {
            const anchorName = anchorRef[1];
            const anchorDef = file.content.match(
              new RegExp(`&${anchorName}\\b[\\s\\S]*?(?=\\n[a-z][\\w-]*:|\\nservices:|$)`),
            );
            if (anchorDef && anchorDef[0].includes("healthcheck")) {
              continue; // healthcheck inherited from anchor
            }
          }
          violations.push(
            `${file.relPath}: service "${name}" has no healthcheck`,
          );
        }
      }
    }

    // Known services without healthcheck (document and shrink this list)
    const KNOWN_NO_HEALTHCHECK = [
      "functions-init",
    ];

    const unexpected = violations.filter(
      (v) => !KNOWN_NO_HEALTHCHECK.some((k) => v.includes(`"${k}"`)),
    );

    expect(
      unexpected,
      "All Coolify services must have healthcheck (port 503 without it):\n" +
        unexpected.join("\n"),
    ).toEqual([]);
  });

  test("no weak placeholder passwords as fallback defaults", () => {
    const violations: string[] = [];

    // Patterns that indicate a placeholder password that should be overridden
    const WEAK_PATTERNS = [
      /change-me-in-production/i,
      /change-in-production/i,
      /your-.*-secret/i,
      /password123/i,
      /admin-password/i,
    ];

    // Credential env var names (only check password/secret/key fields)
    const SENSITIVE_VAR_PATTERN = /(?:PASSWORD|SECRET|SALT|KEY).*:-([^}]+)/i;

    for (const file of COMPOSE_FILES) {
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(SENSITIVE_VAR_PATTERN);
        if (match) {
          const fallback = match[1].trim().replace(/["']/g, "");
          for (const pattern of WEAK_PATTERNS) {
            if (pattern.test(fallback)) {
              violations.push(
                `${file.relPath}:${i + 1} — weak placeholder fallback: "${fallback}"`,
              );
              break;
            }
          }
        }
      }
    }

    // Known accepted weak defaults (local-only compose files)
    const KNOWN_WEAK = violations.filter(
      (v) => v.includes("docker-compose.local"),
    );

    const production = violations.filter(
      (v) => !v.includes("docker-compose.local"),
    );

    // Document: these are production compose files with placeholder passwords.
    // Each MUST be overridden via Coolify env vars.
    // This list should SHRINK over time as we move to ${VAR:?error} syntax.
    const KNOWN_PRODUCTION_WEAK = [
      "coolify-langfuse.yml",
      "coolify-integration.yml",
      "coolify-admin.yml",
    ];

    const unexpected = production.filter(
      (v) => !KNOWN_PRODUCTION_WEAK.some((k) => v.includes(k)),
    );

    expect(
      unexpected,
      "Production compose files with new weak placeholder passwords — use ${VAR:?error} syntax:\n" +
        unexpected.join("\n"),
    ).toEqual([]);
  });
});

// ─── 3. DB Bootstrap Script Security ─────────────────────────────────────────

describe("DB Bootstrap Script Security", () => {
  test("password setup must use parameterized SQL (--set), not shell interpolation", () => {
    if (!DB_WRAPPER) return;

    const violations: string[] = [];
    const lines = DB_WRAPPER.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Detect ALTER ROLE ... WITH PASSWORD '$VAR' or "...$VAR..." — shell interpolation
      if (
        /ALTER\s+ROLE.*PASSWORD\s+['"].*\$/.test(line) &&
        !line.includes(":'") // Exclude psql var syntax :'varname'
      ) {
        violations.push(
          `db-entrypoint-wrapper.sh:${i + 1} — password set via shell interpolation (use --set instead)`,
        );
      }
    }

    expect(
      violations,
      "Password setup must use psql --set for parameterized SQL:\n" + violations.join("\n"),
    ).toEqual([]);
  });

  test("sentinel file must be created only after password verification", () => {
    if (!DB_WRAPPER) return;

    const sentinelLine = DB_WRAPPER.indexOf("touch /tmp/.db-passwords-ready");
    const verifyLine = DB_WRAPPER.indexOf("HASH_CHECK=");

    expect(sentinelLine).toBeGreaterThan(-1);
    expect(verifyLine).toBeGreaterThan(-1);
    expect(
      sentinelLine,
      "Sentinel must come AFTER password hash verification",
    ).toBeGreaterThan(verifyLine);
  });

  test("all application DB roles must have dedicated passwords (not shared POSTGRES_PASSWORD)", () => {
    if (!DB_WRAPPER) return;

    // Application roles that should have their own password env vars
    const APP_ROLES = ["nocodb_app", "langfuse_app"];

    const violations: string[] = [];

    for (const role of APP_ROLES) {
      // Check that the role's password uses a dedicated variable, not just POSTGRES_PASSWORD
      const rolePasswordPattern = new RegExp(
        `ALTER\\s+ROLE\\s+${role}.*PASSWORD`,
        "i",
      );
      if (!rolePasswordPattern.test(DB_WRAPPER)) {
        violations.push(
          `Role "${role}" has no ALTER ROLE ... PASSWORD statement in db-entrypoint-wrapper.sh`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  test("quoted heredocs must not use backslash-escaped dollar-quoting (\\$\\$)", () => {
    if (!DB_WRAPPER) return;

    const violations: string[] = [];
    const lines = DB_WRAPPER.split("\n");

    // Find quoted heredoc blocks: <<'DELIM' ... DELIM
    // Inside these, shell does NOT expand — so \$\$ is a literal bug, not escaping.
    let insideQuotedHeredoc = false;
    let heredocDelim = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect start of quoted heredoc: <<'WORD' or << 'WORD'
      const heredocStart = line.match(/<<\s*'(\w+)'/);
      if (heredocStart) {
        insideQuotedHeredoc = true;
        heredocDelim = heredocStart[1];
        continue;
      }

      // Detect end of quoted heredoc
      if (insideQuotedHeredoc && line.trim() === heredocDelim) {
        insideQuotedHeredoc = false;
        heredocDelim = "";
        continue;
      }

      // Inside quoted heredoc: \$\$ is always a bug (should be plain $$)
      if (insideQuotedHeredoc && /\\\$\\\$/.test(line)) {
        violations.push(
          `db-entrypoint-wrapper.sh:${i + 1} — \\$\\$ inside quoted heredoc <<'${heredocDelim}'>: use $$ instead`,
        );
      }
    }

    expect(
      violations,
      "Quoted heredocs (<<'DELIM') do not expand shell variables — \\$\\$ is a literal bug, not escaping:\n" +
        violations.join("\n"),
    ).toEqual([]);
  });

  test("ownership transfer DO block must exist for all app schema roles", () => {
    if (!DB_WRAPPER) return;

    // These roles need schema ownership transfer (e.g. for Prisma migrations)
    const SCHEMA_OWNER_ROLES = ["langfuse_app"];

    const violations: string[] = [];

    for (const role of SCHEMA_OWNER_ROLES) {
      // Verify DO $$ block that transfers ownership of tables/sequences/views/functions
      // Actual format: EXECUTE 'ALTER TABLE langfuse.' || quote_ident(...) || ' OWNER TO langfuse_app';
      const ownershipPattern = new RegExp(
        `EXECUTE\\s+'ALTER\\s+TABLE\\s+\\w+\\.'.*OWNER\\s+TO\\s+${role}`,
        "i",
      );
      const schemaOwnerPattern = new RegExp(
        `ALTER\\s+SCHEMA\\s+\\w+\\s+OWNER\\s+TO\\s+${role}`,
        "i",
      );

      if (!ownershipPattern.test(DB_WRAPPER)) {
        violations.push(
          `Role "${role}" — missing DO $$ ownership transfer loop for tables/sequences in db-entrypoint-wrapper.sh`,
        );
      }
      if (!schemaOwnerPattern.test(DB_WRAPPER)) {
        violations.push(
          `Role "${role}" — missing ALTER SCHEMA ... OWNER TO in db-entrypoint-wrapper.sh`,
        );
      }
    }

    expect(
      violations,
      "App roles that run migrations (e.g. Prisma) must own their schema objects:\n" +
        violations.join("\n"),
    ).toEqual([]);
  });
});

// ─── 4. n8n Nodes: Credential Security ───────────────────────────────────────

describe("n8n Custom Nodes Security", () => {
  test("credential files must not contain hardcoded tokens or passwords", () => {
    const credsDir = join(ROOT, "packages/n8n-nodes-aisha/credentials");
    if (!existsSync(credsDir)) return;

    const violations: string[] = [];
    const credFiles = readdirSync(credsDir).filter((f) => f.endsWith(".ts"));

    for (const file of credFiles) {
      const content = readSafe(join(credsDir, file));
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Default values for password/token/secret fields should be empty
        if (
          /type:\s*['"]string['"]/.test(line) ||
          /typeOptions.*password/.test(line)
        ) {
          // Check next ~5 lines for a default with a non-empty value
          for (let j = i; j < Math.min(i + 5, lines.length); j++) {
            const checkLine = lines[j];
            const defaultMatch = checkLine.match(
              /default:\s*['"]((?![\s'"])[^'"]+)['"]/,
            );
            if (
              defaultMatch &&
              defaultMatch[1].length > 0 &&
              !defaultMatch[1].startsWith("https://") &&
              !defaultMatch[1].startsWith("http://")
            ) {
              violations.push(
                `${file}:${j + 1} — credential field has non-empty default value: "${defaultMatch[1]}"`,
              );
            }
          }
        }
      }
    }

    expect(
      violations,
      "Credential fields must have empty defaults:\n" + violations.join("\n"),
    ).toEqual([]);
  });

  test("node execute methods must use requireCredString for credential access", () => {
    const nodesDir = join(ROOT, "packages/n8n-nodes-aisha/nodes");
    if (!existsSync(nodesDir)) return;

    const violations: string[] = [];

    for (const dir of readdirSync(nodesDir, { withFileTypes: true })) {
      if (!dir.isDirectory() || dir.name.startsWith("_")) continue;

      const nodeFile = join(nodesDir, dir.name, `${dir.name}.node.ts`);
      if (!existsSync(nodeFile)) continue;

      const content = readSafe(nodeFile);

      // Check for direct credential property access without requireCredString
      const unsafePatterns = [
        /credentials\.\w+\s+as\s+string/,
        /credentials\[['"][^'"]+['"]\]\s+as\s+string/,
        /String\(credentials\.\w+\)/,
      ];

      for (const pattern of unsafePatterns) {
        if (pattern.test(content)) {
          violations.push(
            `${dir.name}: uses unsafe credential access — use requireCredString() instead`,
          );
          break;
        }
      }
    }

    expect(
      violations,
      "n8n nodes must use requireCredString for safe credential access:\n" +
        violations.join("\n"),
    ).toEqual([]);
  });
});

// ─── 5. PKI / TLS Security ──────────────────────────────────────────────────

describe("PKI TLS Security", () => {
  test("no insecure TLS bypass flags in production compose files", () => {
    const INSECURE_PATTERNS = [
      /SSL_INSECURE_SKIP_VERIFY.*true/i,
      /NODE_TLS_REJECT_UNAUTHORIZED\s*[=:]\s*["']?0["']?/i,
      /INSECURE_SSL_FAILOVER.*true/i,
      /REQUESTS_CA_BUNDLE\s*[=:]\s*["']?\/dev\/null["']?/i,
      /SSL_CERT_FILE\s*[=:]\s*["']?\/dev\/null["']?/i,
    ];

    const violations: string[] = [];

    for (const file of COMPOSE_FILES) {
      // Skip local-only compose files
      if (file.relPath.includes("docker-compose.local")) continue;

      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comments
        if (line.trimStart().startsWith("#")) continue;
        for (const pattern of INSECURE_PATTERNS) {
          if (pattern.test(line)) {
            violations.push(
              `${file.relPath}:${i + 1} — insecure TLS bypass: ${line.trim()}`,
            );
            break;
          }
        }
      }
    }

    expect(
      violations,
      "Production compose files must NOT contain insecure TLS bypass flags.\n" +
        "Use PKI trust bundle (PROVIDER_CA_FILES / NODE_EXTRA_CA_CERTS) instead:\n" +
        violations.join("\n"),
    ).toEqual([]);
  });

  test("services with OIDC issuer should have CA trust configured", () => {
    const violations: string[] = [];

    for (const file of COMPOSE_FILES) {
      if (file.relPath.includes("docker-compose.local")) continue;

      // Find services with OIDC issuer configured
      const lines = file.content.split("\n");
      let currentService = "";
      let hasOidcIssuer = false;
      let hasTrustConfig = false;
      let hasSkipDiscovery = false;

      for (const line of lines) {
        const svcMatch = line.match(/^\s{2}(\w[\w-]*):\s*$/);
        if (svcMatch) {
          // Check previous service — skip-discovery + internal HTTP backchannel
          // doesn't need CA trust (no TLS on the backchannel path)
          if (currentService && hasOidcIssuer && !hasTrustConfig && !hasSkipDiscovery) {
            violations.push(
              `${file.relPath} → ${currentService}: has OIDC_ISSUER_URL but no PROVIDER_CA_FILES or NODE_EXTRA_CA_CERTS`,
            );
          }
          currentService = svcMatch[1];
          hasOidcIssuer = false;
          hasTrustConfig = false;
          hasSkipDiscovery = false;
        }
        if (/OIDC_ISSUER_URL/.test(line)) hasOidcIssuer = true;
        if (/PROVIDER_CA_FILES|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE/.test(line))
          hasTrustConfig = true;
        if (/SKIP_OIDC_DISCOVERY.*true/i.test(line))
          hasSkipDiscovery = true;
      }
      // Check last service
      if (currentService && hasOidcIssuer && !hasTrustConfig && !hasSkipDiscovery) {
        violations.push(
          `${file.relPath} → ${currentService}: has OIDC_ISSUER_URL but no PROVIDER_CA_FILES or NODE_EXTRA_CA_CERTS`,
        );
      }
    }

    expect(
      violations,
      "Services with OIDC issuer must configure CA trust for TLS verification:\n" +
        violations.join("\n"),
    ).toEqual([]);
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract the YAML block for a given service name from raw compose content. */
function extractServiceBlock(raw: string, serviceName: string): string | null {
  const lines = raw.split("\n");
  let inService = false;
  let indent = 0;
  const block: string[] = [];

  for (const line of lines) {
    const match = line.match(new RegExp(`^(\\s{2})${serviceName}:`));
    if (match) {
      inService = true;
      indent = match[1].length;
      block.push(line);
      continue;
    }

    if (inService) {
      // Next service at same indent level
      if (line.match(/^\s{2}\S+:/) && !line.match(/^\s{4}/)) {
        break;
      }
      block.push(line);
    }
  }

  return block.length > 0 ? block.join("\n") : null;
}
