import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");

/**
 * Load shared constants from registry.mjs at runtime.
 * We read the source file to extract values without ESM import issues in Vitest.
 */
const registrySource = fs.readFileSync(
  path.join(ROOT, "scripts/ide-adapters/registry.mjs"),
  "utf-8",
);

/** Extract the auto-gen marker from registry source. */
function extractAutoGenMarker(): string {
  const match = registrySource.match(
    /AUTO_GEN_MARKER\s*=\s*["'](.+?)["']/,
  );
  return match?.[1] ?? "Auto-generated from AISHA Expert Overlay ruleset.";
}

/** Extract ADAPTERS registry as { id: outputPath } map. */
function extractAdaptersFromRegistry(): Record<string, string> {
  const adapters: Record<string, string> = {};
  // Match: "adapter-id": { ... outputPath: "some/path" ... }
  const blocks = registrySource.split("export const ADAPTERS")[1];
  if (!blocks) return adapters;
  const entryRegex = /["']?([a-z-]+)["']?\s*:\s*\{[^}]*outputPath:\s*["']([^"']+)["']/g;
  let m;
  while ((m = entryRegex.exec(blocks)) !== null) {
    adapters[m[1]] = m[2];
  }
  return adapters;
}

/** Extract STALENESS_TOLERANCE_MS from registry. */
function extractStalenessTolerance(): number {
  const match = registrySource.match(/STALENESS_TOLERANCE_MS\s*=\s*(\d[\d_]*)/);
  return match ? Number(match[1].replace(/_/g, "")) : 60_000;
}

const AUTO_GEN_MARKER = extractAutoGenMarker();
const REGISTRY_ADAPTERS = extractAdaptersFromRegistry();
const STALENESS_TOLERANCE_MS = extractStalenessTolerance();

/**
 * Gate test: IDE instruction files freshness and structural validity.
 *
 * Verifies that auto-generated IDE instruction files:
 * 1. Exist where expected
 * 2. Contain the auto-generation marker
 * 3. Contain valid metadata footer
 * 4. Have consistent fingerprints across all generated files
 */

interface IdeFileSpec {
  path: string;
  adapterId: string;
  required: boolean;
}

/**
 * IDE file specs derived from ADAPTERS registry.
 * Required files: copilot, agents, claude (core IDEs).
 * Optional files: cursorrules, windsurfrules, aisha-agent, codex-skill.
 */
const REQUIRED_ADAPTERS = new Set(["copilot", "agents", "claude"]);

const IDE_FILES: IdeFileSpec[] = Object.entries(REGISTRY_ADAPTERS).map(
  ([adapterId, outputPath]) => ({
    path: outputPath,
    adapterId,
    required: REQUIRED_ADAPTERS.has(adapterId),
  }),
);

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

function extractMetadataFooter(content: string): Record<string, unknown> | null {
  // Metadata footer is last JSON block in the file
  const lines = content.trim().split("\n");
  let jsonStart = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === "{") {
      jsonStart = i;
      break;
    }
  }
  if (jsonStart < 0) return null;
  const jsonBlock = lines.slice(jsonStart).join("\n");
  try {
    return JSON.parse(jsonBlock);
  } catch {
    return null;
  }
}

describe("IDE instruction files — adapter infrastructure", () => {
  it("adapter registry exists with all required adapters", () => {
    const registryPath = path.join(ROOT, "scripts/ide-adapters/registry.mjs");
    expect(fs.existsSync(registryPath)).toBe(true);
    const content = read(registryPath);
    expect(content).toContain("copilot");
    expect(content).toContain("agents");
    expect(content).toContain("claude");
    expect(content).toContain("cursorrules");
    expect(content).toContain("windsurfrules");
    expect(content).toContain("zedrules");
    expect(content).toContain("aisha-agent");
    expect(content).toContain("codex-skill");
  });

  it("all adapter files exist", () => {
    const adapterDir = path.join(ROOT, "scripts/ide-adapters");
    const expectedAdapters = Object.keys(REGISTRY_ADAPTERS);
    for (const id of expectedAdapters) {
      const adapterPath = path.join(adapterDir, `adapter-${id}.mjs`);
      expect(fs.existsSync(adapterPath), `Missing adapter: adapter-${id}.mjs`).toBe(true);
    }
  });

  it("payload loader module exists", () => {
    const payloadPath = path.join(ROOT, "scripts/ide-adapters/payload.mjs");
    expect(fs.existsSync(payloadPath)).toBe(true);
    const content = read(payloadPath);
    expect(content).toContain("fetchPayload");
    expect(content).toContain("loadPayloadFromFile");
    expect(content).toContain("savePayloadToFile");
    expect(content).toContain("readStoryId");
  });

  it("CLI entrypoint exists with proper options", () => {
    const cliPath = path.join(ROOT, "scripts/generate-ide-instructions.mjs");
    expect(fs.existsSync(cliPath)).toBe(true);
    const content = read(cliPath);
    expect(content).toContain("--format=");
    expect(content).toContain("--offline");
    expect(content).toContain("--save-payload");
    expect(content).toContain("--dry-run");
  });

  it("SQL function source of truth exists", () => {
    const sqlPath = path.join(ROOT, "aisha/db/sql/functions/get_instruction_payload.sql");
    expect(fs.existsSync(sqlPath)).toBe(true);
    const content = read(sqlPath);
    expect(content).toContain("get_instruction_payload");
    expect(content).toContain("SECURITY DEFINER");
    expect(content).toContain("SET search_path TO 'public'");
    expect(content).toContain("REVOKE ALL");
    expect(content).toContain("GRANT EXECUTE");
  });

  it("npm scripts configured for generation", () => {
    const pkgPath = path.join(ROOT, "package.json");
    const pkg = JSON.parse(read(pkgPath));
    expect(pkg.scripts["gen:ide"]).toBeDefined();
    expect(pkg.scripts["gen:ide:offline"]).toBeDefined();
    expect(pkg.scripts["gen:ide:save"]).toBeDefined();
  });
});

describe("IDE instruction files — content freshness", () => {
  for (const spec of IDE_FILES) {
    const filePath = path.join(ROOT, spec.path);
    const exists = fs.existsSync(filePath);

    if (spec.required) {
      it(`required file exists: ${spec.path}`, () => {
        expect(exists, `Required IDE instruction file missing: ${spec.path}`).toBe(true);
      });
    }

    if (exists) {
      it(`${spec.path} contains auto-generation marker`, () => {
        const content = read(filePath);
        const hasAutoGenMarker = content.includes(AUTO_GEN_MARKER);

        expect(
          hasAutoGenMarker,
          `${spec.path} must contain auto-generation marker: "${AUTO_GEN_MARKER}"`,
        ).toBe(true);
      });
    }
  }

  it("copilot-instructions.md has valid structure", () => {
    const filePath = path.join(ROOT, ".github/copilot-instructions.md");
    if (!fs.existsSync(filePath)) return;
    const content = read(filePath);
    expect(content).toContain("Expert Rules");
    expect(content).toContain("PR Checklist");
  });

  it("auto-generated files have consistent fingerprints", () => {
    const fingerprints = new Set<string>();
    for (const spec of IDE_FILES) {
      const filePath = path.join(ROOT, spec.path);
      if (!fs.existsSync(filePath)) continue;
      const content = read(filePath);
      const meta = extractMetadataFooter(content);
      if (meta?.fingerprint && typeof meta.fingerprint === "string") {
        fingerprints.add(meta.fingerprint);
      }
    }
    // All auto-generated files should share the same fingerprint
    expect(
      fingerprints.size <= 1,
      `Auto-generated files should share fingerprint, found: ${[...fingerprints].join(", ")}`,
    ).toBe(true);
  });

  it("adapter source files are not newer than registry (staleness check)", () => {
    const registryPath = path.join(ROOT, "scripts/ide-adapters/registry.mjs");
    if (!fs.existsSync(registryPath)) return;
    const registryMtime = fs.statSync(registryPath).mtimeMs;

    const adapterDir = path.join(ROOT, "scripts/ide-adapters");
    const adapterFiles = fs
      .readdirSync(adapterDir)
      .filter((f) => f.startsWith("adapter-") && f.endsWith(".mjs"));

    for (const file of adapterFiles) {
      const adapterMtime = fs.statSync(path.join(adapterDir, file)).mtimeMs;
      // Adapter file must not be significantly newer than registry
      expect(
        adapterMtime <= registryMtime + STALENESS_TOLERANCE_MS,
        `Adapter ${file} was modified after registry.mjs — run 'npm run gen:ide' to regenerate`,
      ).toBe(true);
    }
  });
});
