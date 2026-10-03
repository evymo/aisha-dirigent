import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  USER_SECTION_OPEN,
  USER_SECTION_CLOSE,
  AUTO_GEN_MARKER,
  hasAutoGenHeader,
  extractUserSection,
  injectUserSection,
  safeWriteSync,
} from "../../../scripts/lib/ide-instructions-safety.mjs";

/**
 * Gate test: IDE instruction file regeneration must never destroy user work.
 *
 * Three guarantees:
 *  1. Files without the AISHA auto-gen header are refused (user-owned).
 *  2. A user-section block (markers <!-- aisha:user-section:start --> / :end)
 *     is preserved across regenerations.
 *  3. Every overwrite leaves a timestamped backup in .aisha/backups/.
 */
describe("IDE instructions safety", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aisha-ide-safety-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const eq = (a: string, b: string): boolean => a === b;

  function generated(body: string): string {
    return `# CLAUDE.md\n\n> ${AUTO_GEN_MARKER}\n\n${body}\n\n<!-- gen:metadata {"k":1} -->\n`;
  }

  it("refuses to overwrite a user-owned file (no auto-gen header)", () => {
    const target = path.join(tmpDir, "CLAUDE.md");
    fs.writeFileSync(target, "# my own notes — not AISHA managed\n");

    const outcome = safeWriteSync(tmpDir, "CLAUDE.md", generated("rules"), eq);

    expect(outcome.outcome).toBe("refused-user-owned");
    expect(fs.readFileSync(target, "utf-8")).toBe("# my own notes — not AISHA managed\n");
    expect(fs.existsSync(path.join(tmpDir, ".aisha", "backups"))).toBe(false);
  });

  it("preserves the user-section block across regenerations", () => {
    const userBody = "\n## My override\nUse REST not GraphQL\n";
    const existing = generated(
      `Old rules\n\n${USER_SECTION_OPEN}${userBody}${USER_SECTION_CLOSE}\n`,
    );
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), existing);

    const outcome = safeWriteSync(tmpDir, "CLAUDE.md", generated("New rules"), eq);

    expect(outcome.outcome).toBe("written");
    expect(outcome.preservedUserSection).toBe(true);

    const written = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(written).toContain("New rules");
    expect(written).toContain(userBody);
    expect(written).toContain(USER_SECTION_OPEN);
    expect(written).toContain(USER_SECTION_CLOSE);
  });

  it("creates a timestamped backup before overwriting", () => {
    const existing = generated("Old rules");
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), existing);

    const outcome = safeWriteSync(tmpDir, "CLAUDE.md", generated("New rules"), eq);

    expect(outcome.outcome).toBe("written");
    expect(outcome.backupPath).toBeDefined();
    expect(outcome.backupPath).toMatch(/^CLAUDE\.md\..+\.bak$/);

    const backupContent = fs.readFileSync(
      path.join(tmpDir, ".aisha", "backups", outcome.backupPath!),
      "utf-8",
    );
    expect(backupContent).toBe(existing);
  });

  it("rotates backups, keeping at most 5 per file", () => {
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), generated("v0"));
    for (let i = 1; i <= 8; i++) {
      safeWriteSync(tmpDir, "CLAUDE.md", generated(`v${i}`), () => false);
    }
    const backups = fs.readdirSync(path.join(tmpDir, ".aisha", "backups"));
    expect(backups.length).toBeLessThanOrEqual(5);
  });

  it("skips identical content (volatile-stripped)", () => {
    const content = generated("Same");
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), content);

    const outcome = safeWriteSync(tmpDir, "CLAUDE.md", content, eq);
    expect(outcome.outcome).toBe("skipped-identical");
  });

  it("seeds an empty user-section template into fresh files", () => {
    const outcome = safeWriteSync(tmpDir, "CLAUDE.md", generated("Body"), eq);

    expect(outcome.outcome).toBe("written");
    const written = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(written).toContain(USER_SECTION_OPEN);
    expect(written).toContain(USER_SECTION_CLOSE);
    expect(written).toContain("preserved across regenerations");
  });

  it("hasAutoGenHeader returns false for arbitrary user files", () => {
    expect(hasAutoGenHeader("# my notes")).toBe(false);
    expect(hasAutoGenHeader(`# title\n\n> ${AUTO_GEN_MARKER}\n`)).toBe(true);
  });

  it("extractUserSection returns null when block is absent", () => {
    expect(extractUserSection("no markers here")).toBeNull();
    const withBlock = `prefix${USER_SECTION_OPEN}inner${USER_SECTION_CLOSE}suffix`;
    expect(extractUserSection(withBlock)).toBe("inner");
  });

  it("injectUserSection replaces an existing block in place", () => {
    const orig = `head\n${USER_SECTION_OPEN}OLD${USER_SECTION_CLOSE}\ntail`;
    const out = injectUserSection(orig, "NEW");
    expect(out).toContain("NEW");
    expect(out).not.toContain("OLD");
    expect((out.match(new RegExp(USER_SECTION_OPEN, "g")) ?? []).length).toBe(1);
  });
});

describe("Auto-regen gate is conservative by default", () => {
  it("VS Code config schema defaults autoRegenerate.enabled to false", () => {
    const pkg = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "../../../extensions/aisha-dirigent/package.json"),
        "utf-8",
      ),
    );
    const props = pkg.contributes.configuration.properties;
    expect(props["aisha.dirigent.autoRegenerate.enabled"]).toBeDefined();
    expect(props["aisha.dirigent.autoRegenerate.enabled"].default).toBe(false);
    expect(props["aisha.dirigent.autoRegenerate.triggers"].default).toEqual(["manual"]);
    expect(props["aisha.dirigent.shareWorkspaceContext"].default).toBe(false);
  });
});

/**
 * Anti-regression: every place in the extension that writes a managed file
 * into the developer's workspace must go through `safeWrite`/`safeWriteFromUri`/
 * `safeWriteJson` rather than calling `vscode.workspace.fs.writeFile` directly.
 *
 * If a future patch adds a raw write to one of these files, this test will
 * fail and force the author to either route through the safety helper or
 * justify (and add) an exception here.
 */
describe("Agent-on-machine safety contract: no raw writes to managed paths", () => {
  const EXT_ROOT = path.resolve(__dirname, "../../../extensions/aisha-dirigent/src");

  function readFile(rel: string): string {
    return fs.readFileSync(path.join(EXT_ROOT, rel), "utf-8");
  }

  it("participant.ts writes copilot-instructions.md only via safeWriteFromUri", () => {
    const src = readFile("participant.ts");
    const rawWriteToCopilot = /writeFile\([^)]*copilot-instructions/m.test(src);
    expect(rawWriteToCopilot).toBe(false);
    expect(src.includes("safeWriteFromUri")).toBe(true);
  });

  it("config-writer.ts writes prompt-template.md only via safeWriteFromUri", () => {
    const src = readFile("config-writer.ts");
    const rawWriteToTemplate = /writeFile\([^)]*prompt-template/m.test(src);
    expect(rawWriteToTemplate).toBe(false);
    expect(src.includes("safeWriteFromUri")).toBe(true);
  });

  it("config-writer.ts writes active-rules.json only via safeWriteJson (backup-aware)", () => {
    const src = readFile("config-writer.ts");
    const rawWriteToRules = /writeFile\([^)]*active-rules/m.test(src);
    expect(rawWriteToRules).toBe(false);
    expect(src.includes("safeWriteJson")).toBe(true);
  });

  it("generate-all.ts writes only via safeWrite", () => {
    const src = readFile("generators/generate-all.ts");
    expect(src.includes("safeWrite")).toBe(true);
    const rawWrites = src.match(/vscode\.workspace\.fs\.writeFile/g);
    expect(rawWrites).toBeNull();
  });
});
