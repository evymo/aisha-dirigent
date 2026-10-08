/**
 * Unit tests for safe-write — Phase 13 WP 13.3 core primitive.
 *
 * Covers the three guarantees:
 *   1. User-owned files (no AISHA-MANAGED-START) get PREPENDED, not overwritten
 *   2. USER-CUSTOM content preserved across syncs (delimiter-bounded)
 *   3. Every write produces a timestamped backup in .aisha/backups/
 *
 * Also covers:
 *   - delimiter helpers (extract / replace)
 *   - identity skip via contentEquals (timestamp-volatile stripping)
 *   - backup rotation (last N retained)
 *   - fresh write (new file)
 *   - new file with delimiters → straight write
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  AISHA_MANAGED_START,
  AISHA_MANAGED_END,
  USER_CUSTOM_START,
  USER_CUSTOM_END,
  extractUserCustomSection,
  extractAishaManagedBlock,
  replaceUserCustomSection,
  defaultContentEquals,
  safeWriteSync,
  assertWithinRoot,
  PathEscapeError,
} from "../safe-write.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "aisha-ide-bridge-test-"));
});
// Bez úklidu zůstával adresář po KAŽDÉM testu (naměřeno 2026-10-02: 2 214 v $TMPDIR).
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function readFile(rel: string): string {
  return readFileSync(path.join(tmpRoot, rel), "utf8");
}

function templateContent(aishaBody: string, userBody = ""): string {
  return [
    "# CLAUDE.md — AISHA Platform",
    "",
    AISHA_MANAGED_START,
    aishaBody,
    AISHA_MANAGED_END,
    "",
    USER_CUSTOM_START,
    userBody,
    USER_CUSTOM_END,
    "",
  ].join("\n");
}

// ─── Path containment guard ───────────────────────────────────────────────────

describe("assertWithinRoot — path containment", () => {
  it("allows a plain relative path inside root", () => {
    expect(assertWithinRoot(tmpRoot, "CLAUDE.md")).toBe(path.join(tmpRoot, "CLAUDE.md"));
    expect(assertWithinRoot(tmpRoot, "sub/dir/file.md")).toBe(path.join(tmpRoot, "sub/dir/file.md"));
  });

  it("rejects ../ traversal that escapes root", () => {
    expect(() => assertWithinRoot(tmpRoot, "../../.ssh/authorized_keys")).toThrow(PathEscapeError);
  });

  it("rejects an absolute path pointing outside root", () => {
    expect(() => assertWithinRoot(tmpRoot, "/etc/passwd")).toThrow(PathEscapeError);
  });

  it("rejects a sibling-prefix path (root-foo is not inside root)", () => {
    expect(() => assertWithinRoot("/a/root", "../root-foo/x")).toThrow(PathEscapeError);
  });

  it("safeWriteSync refuses to write outside root", () => {
    expect(() =>
      safeWriteSync({ rootDir: tmpRoot, outputPath: "../escape.md", newContent: "x" }),
    ).toThrow(PathEscapeError);
    expect(existsSync(path.join(tmpRoot, "..", "escape.md"))).toBe(false);
  });
});

// ─── Delimiter helpers ────────────────────────────────────────────────────────

describe("extractUserCustomSection", () => {
  it("extracts inner content between USER-CUSTOM markers", () => {
    const src = templateContent("aisha", "hello world");
    expect(extractUserCustomSection(src)).toBe("\nhello world\n");
  });

  it("returns null when start marker missing", () => {
    expect(extractUserCustomSection("no markers here")).toBeNull();
  });

  it("returns null when end marker missing", () => {
    const broken = `before ${USER_CUSTOM_START} unclosed`;
    expect(extractUserCustomSection(broken)).toBeNull();
  });
});

describe("extractAishaManagedBlock", () => {
  it("extracts INCLUDING the delimiter markers", () => {
    const src = templateContent("body");
    const out = extractAishaManagedBlock(src)!;
    expect(out.startsWith(AISHA_MANAGED_START)).toBe(true);
    expect(out.endsWith(AISHA_MANAGED_END)).toBe(true);
    expect(out).toContain("body");
  });

  it("returns null when start marker missing", () => {
    expect(extractAishaManagedBlock("plain text")).toBeNull();
  });
});

describe("replaceUserCustomSection", () => {
  it("substitutes inner content while preserving delimiters", () => {
    const target = templateContent("aisha", "OLD");
    const result = replaceUserCustomSection(target, "NEW USER CONTENT");
    expect(result).toContain(USER_CUSTOM_START + "NEW USER CONTENT" + USER_CUSTOM_END);
    expect(result).not.toContain("OLD");
  });

  it("returns target unchanged when delimiters absent", () => {
    const target = "no markers";
    expect(replaceUserCustomSection(target, "x")).toBe("no markers");
  });
});

// ─── defaultContentEquals ─────────────────────────────────────────────────────

describe("defaultContentEquals", () => {
  it("treats files as equal when only generated_at timestamp differs", () => {
    const a = "generated_at: 2026-05-19T10:00:00Z\nbody";
    const b = "generated_at: 2026-05-20T11:11:11Z\nbody";
    expect(defaultContentEquals(a, b)).toBe(true);
  });

  it("treats files as different when body differs", () => {
    const a = "generated_at: 2026-05-19T10:00:00Z\nbody A";
    const b = "generated_at: 2026-05-19T10:00:00Z\nbody B";
    expect(defaultContentEquals(a, b)).toBe(false);
  });

  it("ignores the dynamic-generated header form too", () => {
    const a = "# title (dynamic, generated 2026-05-19T10:00:00Z)\nx";
    const b = "# title (dynamic, generated 2026-05-20T11:11:11Z)\nx";
    expect(defaultContentEquals(a, b)).toBe(true);
  });
});

// ─── Guarantee A — New file: straight write ───────────────────────────────────

describe("safeWriteSync: new file path", () => {
  it("writes new file when target doesn't exist", () => {
    const newContent = templateContent("hello");
    const result = safeWriteSync({
      rootDir: tmpRoot,
      outputPath: "CLAUDE.md",
      newContent,
    });
    expect(result.outcome).toBe("written");
    expect(result.treatedAsUserOwned).toBe(false);
    expect(result.preservedUserSection).toBe(false);
    expect(readFile("CLAUDE.md")).toBe(newContent);
  });

  it("creates parent directories if missing", () => {
    const newContent = templateContent("x");
    const result = safeWriteSync({
      rootDir: tmpRoot,
      outputPath: ".github/copilot-instructions.md",
      newContent,
    });
    expect(result.outcome).toBe("written");
    expect(existsSync(path.join(tmpRoot, ".github/copilot-instructions.md"))).toBe(true);
  });
});

// ─── Guarantee B — User-owned files: prepend, never overwrite ─────────────────

describe("safeWriteSync: existing file WITHOUT AISHA delimiters", () => {
  it("PREPENDS AISHA block + preserves original content below", () => {
    writeFileSync(path.join(tmpRoot, "CLAUDE.md"), "# Hand-authored CLAUDE.md\nLine 1\nLine 2\n");
    const newContent = templateContent("FRESH AISHA BLOCK");

    const result = safeWriteSync({
      rootDir: tmpRoot,
      outputPath: "CLAUDE.md",
      newContent,
    });

    expect(result.outcome).toBe("appended-to-user-owned");
    expect(result.treatedAsUserOwned).toBe(true);

    const merged = readFile("CLAUDE.md");
    // AISHA block at top
    expect(merged.startsWith(AISHA_MANAGED_START)).toBe(true);
    expect(merged).toContain("FRESH AISHA BLOCK");
    // Original user content preserved verbatim
    expect(merged).toContain("# Hand-authored CLAUDE.md");
    expect(merged).toContain("Line 1");
    expect(merged).toContain("Line 2");
    // Marker comment explaining what happened
    expect(merged).toContain("USER-CONTENT (preserved from your existing file)");
  });

  it("creates a backup before prepending", () => {
    writeFileSync(path.join(tmpRoot, "CLAUDE.md"), "user-authored content here");
    const result = safeWriteSync({
      rootDir: tmpRoot,
      outputPath: "CLAUDE.md",
      newContent: templateContent("x"),
    });

    expect(result.outcome).toBe("appended-to-user-owned");
    expect(result.backupFile).toBeDefined();
    const backupsDir = path.join(tmpRoot, ".aisha/backups");
    expect(existsSync(backupsDir)).toBe(true);
    const backupFiles = readdirSync(backupsDir);
    expect(backupFiles.length).toBe(1);
    // Backup contains the ORIGINAL user-authored content (so user can restore)
    const backupContent = readFileSync(path.join(backupsDir, backupFiles[0]), "utf8");
    expect(backupContent).toBe("user-authored content here");
  });
});

// ─── Guarantee C — Existing AISHA file: merge + preserve USER-CUSTOM ──────────

describe("safeWriteSync: existing file WITH AISHA delimiters", () => {
  it("merges new AISHA block + preserves existing USER-CUSTOM content", () => {
    const existing = templateContent("OLD AISHA", "MY PERSONAL NOTES");
    writeFileSync(path.join(tmpRoot, "CLAUDE.md"), existing);

    const newContent = templateContent("NEW AISHA", ""); // fresh template has empty USER block
    const result = safeWriteSync({
      rootDir: tmpRoot,
      outputPath: "CLAUDE.md",
      newContent,
    });

    expect(result.outcome).toBe("written");
    expect(result.preservedUserSection).toBe(true);

    const merged = readFile("CLAUDE.md");
    expect(merged).toContain("NEW AISHA");
    expect(merged).not.toContain("OLD AISHA");
    // User content preserved
    expect(merged).toContain("MY PERSONAL NOTES");
  });

  it("skips identical write (no backup, no churn) when only timestamp differs", () => {
    const existing = templateContent("body", "");
    writeFileSync(path.join(tmpRoot, "CLAUDE.md"), existing);

    // Same content body — but stick a timestamp in there to verify the
    // defaultContentEquals stripping path
    const newContent = "generated_at: 2026-05-21T01:02:03Z\n" + existing;
    const existingWithTs = "generated_at: 2026-05-20T01:02:03Z\n" + existing;
    writeFileSync(path.join(tmpRoot, "CLAUDE.md"), existingWithTs);

    const result = safeWriteSync({
      rootDir: tmpRoot,
      outputPath: "CLAUDE.md",
      newContent,
    });
    expect(result.outcome).toBe("skipped-identical");
    expect(result.backupFile).toBeUndefined();
    // File unchanged
    expect(readFile("CLAUDE.md")).toBe(existingWithTs);
  });

  it("creates a backup on real-change merge", () => {
    writeFileSync(path.join(tmpRoot, "CLAUDE.md"), templateContent("OLD"));
    const result = safeWriteSync({
      rootDir: tmpRoot,
      outputPath: "CLAUDE.md",
      newContent: templateContent("NEW"),
    });
    expect(result.outcome).toBe("written");
    expect(result.backupFile).toBeDefined();
    const backups = readdirSync(path.join(tmpRoot, ".aisha/backups"));
    expect(backups.length).toBe(1);
  });
});

// ─── Backup rotation ──────────────────────────────────────────────────────────

describe("backup rotation", () => {
  it("retains only the last N backups per file (default 5)", async () => {
    writeFileSync(path.join(tmpRoot, "CLAUDE.md"), templateContent("v0"));
    // Trigger 7 writes — each version produces a backup of the PRIOR version
    for (let i = 1; i <= 7; i++) {
      // Add a microsecond's worth of wait so timestamps differ
      await new Promise((resolve) => setTimeout(resolve, 10));
      safeWriteSync({
        rootDir: tmpRoot,
        outputPath: "CLAUDE.md",
        newContent: templateContent(`v${i}`),
      });
    }
    const backups = readdirSync(path.join(tmpRoot, ".aisha/backups"));
    expect(backups.length).toBe(5); // default retention
  });

  it("respects custom backupsPerFile override", async () => {
    writeFileSync(path.join(tmpRoot, "CLAUDE.md"), templateContent("v0"));
    for (let i = 1; i <= 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      safeWriteSync({
        rootDir: tmpRoot,
        outputPath: "CLAUDE.md",
        newContent: templateContent(`v${i}`),
        backupsPerFile: 2,
      });
    }
    const backups = readdirSync(path.join(tmpRoot, ".aisha/backups"));
    expect(backups.length).toBe(2);
  });
});

// ─── PII / safety ─────────────────────────────────────────────────────────────

describe("PII / safety guarantees", () => {
  it("USER-CUSTOM content is NOT echoed into the AISHA block", () => {
    // User's email lives in the USER-CUSTOM block (preserved data)
    const existing = templateContent("aisha-body", "Contact: user@example.com");
    writeFileSync(path.join(tmpRoot, "CLAUDE.md"), existing);

    const newContent = templateContent("fresh-aisha", "");
    safeWriteSync({
      rootDir: tmpRoot,
      outputPath: "CLAUDE.md",
      newContent,
    });

    const merged = readFile("CLAUDE.md");
    // Email survives in its USER-CUSTOM block
    expect(merged).toContain("user@example.com");
    // BUT does NOT leak into the AISHA-MANAGED block
    const aishaBlock = extractAishaManagedBlock(merged)!;
    expect(aishaBlock).not.toContain("user@example.com");
  });
});
