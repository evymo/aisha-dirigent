/**
 * system-info.test.ts — Hardware detection (real system calls).
 *
 * Tests: getChipInfo (against real OS APIs), getOllamaVersion (connection refused).
 * This is a REAL test — getChipInfo runs against actual os.cpus()/os.totalmem().
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Tests ────────────────────────────────────────────────────────────

describe("getChipInfo — real OS detection", () => {
  beforeEach(() => vi.resetModules());

  it("returns valid structure", async () => {
    const { getChipInfo } = await import("../src/system-info");
    const chip = getChipInfo();
    expect(chip).toHaveProperty("name");
    expect(chip).toHaveProperty("cores");
    expect(chip).toHaveProperty("arch");
    expect(chip).toHaveProperty("memoryGb");
    expect(chip).toHaveProperty("isAppleSilicon");
  });

  it("cores > 0 (real hardware)", async () => {
    const { getChipInfo } = await import("../src/system-info");
    const chip = getChipInfo();
    expect(chip.cores).toBeGreaterThan(0);
  });

  it("memoryGb > 0 (real hardware)", async () => {
    const { getChipInfo } = await import("../src/system-info");
    const chip = getChipInfo();
    expect(chip.memoryGb).toBeGreaterThan(0);
  });

  it("arch is non-empty string", async () => {
    const { getChipInfo } = await import("../src/system-info");
    const chip = getChipInfo();
    expect(typeof chip.arch).toBe("string");
    expect(chip.arch.length).toBeGreaterThan(0);
  });

  it("name is non-empty string", async () => {
    const { getChipInfo } = await import("../src/system-info");
    const chip = getChipInfo();
    expect(typeof chip.name).toBe("string");
    expect(chip.name.length).toBeGreaterThan(0);
  });

  it("isAppleSilicon is boolean", async () => {
    const { getChipInfo } = await import("../src/system-info");
    const chip = getChipInfo();
    expect(typeof chip.isAppleSilicon).toBe("boolean");
  });

  it("isAppleSilicon consistent with platform + arch", async () => {
    const { getChipInfo } = await import("../src/system-info");
    const chip = getChipInfo();
    const os = await import("os");
    if (os.arch() === "arm64" && process.platform === "darwin") {
      expect(chip.isAppleSilicon).toBe(true);
    } else {
      expect(chip.isAppleSilicon).toBe(false);
    }
  });
});

describe("getOllamaVersion", () => {
  beforeEach(() => vi.resetModules());

  it("returns null or string (depends on local Ollama)", async () => {
    const { getOllamaVersion } = await import("../src/system-info");
    const version = await getOllamaVersion();
    // Either null (Ollama not running) or a version string
    if (version !== null) {
      expect(typeof version).toBe("string");
      expect(version.length).toBeGreaterThan(0);
    } else {
      expect(version).toBeNull();
    }
  });
});
