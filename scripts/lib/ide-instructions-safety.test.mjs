import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { safeWriteExecutableSync } from "./ide-instructions-safety.mjs";

describe("safeWriteExecutableSync", () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "aisha-exec-safe-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const rel = path.join(".claude", "hooks", "aisha-advise.sh");

  it("writes a new executable file with mode 0o755 (no backup, no user-section markers)", () => {
    const content = "#!/usr/bin/env bash\necho hi\n";
    const res = safeWriteExecutableSync(root, rel, content);

    expect(res.outcome).toBe("written");
    expect(res.backupPath).toBeUndefined();

    const written = readFileSync(path.join(root, rel), "utf-8");
    expect(written).toBe(content);
    // no HTML user-section noise injected into shell scripts
    expect(written).not.toContain("aisha:user-section");

    const mode = statSync(path.join(root, rel)).mode & 0o777;
    expect(mode).toBe(0o755);

    // fresh write makes no backup
    expect(existsSync(path.join(root, ".aisha", "backups"))).toBe(false);
  });

  it("writes a timestamped backup when the content changes", () => {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, "#!/bin/sh\necho old\n");

    const res = safeWriteExecutableSync(root, rel, "#!/bin/sh\necho new\n");
    expect(res.outcome).toBe("written");
    expect(res.backupPath).toBeTruthy();

    expect(readFileSync(abs, "utf-8")).toBe("#!/bin/sh\necho new\n");

    const backupsDir = path.join(root, ".aisha", "backups");
    const backups = readdirSync(backupsDir).filter((n) => n.endsWith(".bak"));
    expect(backups.length).toBe(1);
    expect(readFileSync(path.join(backupsDir, backups[0]), "utf-8")).toBe("#!/bin/sh\necho old\n");
  });

  it("skips when the new content is byte-identical (no write, no backup)", () => {
    const abs = path.join(root, rel);
    const content = "#!/bin/sh\necho same\n";
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);

    const res = safeWriteExecutableSync(root, rel, content);
    expect(res.outcome).toBe("skipped-identical");

    // no backups dir created on a skip
    expect(existsSync(path.join(root, ".aisha", "backups"))).toBe(false);
  });
});
