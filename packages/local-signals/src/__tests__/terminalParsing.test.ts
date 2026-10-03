import { describe, it, expect } from "vitest";
import {
  classifyCommand,
  parseTscErrors,
  parseTestErrors,
  parseBuildErrors,
  parseLintErrors,
  parseI18nErrors,
  parseErrors,
  parseTestSummary,
  extractRelevantExcerpt,
  buildTerminalReport,
} from "../terminalParsing";

describe("classifyCommand", () => {
  it("classifies npm run test:run", () => {
    const result = classifyCommand("npm run test:run -- src/tests/hooks/useMyHook.test.ts");
    expect(result).toEqual({ type: "test", label: "Unit testy" });
  });

  it("classifies vitest", () => {
    const result = classifyCommand("npx vitest run");
    expect(result).toEqual({ type: "test", label: "Unit testy" });
  });

  it("classifies tsc --noEmit", () => {
    const result = classifyCommand("npx tsc --noEmit");
    expect(result).toEqual({ type: "typecheck", label: "TypeScript check" });
  });

  it("classifies npm run build", () => {
    const result = classifyCommand("npm run build");
    expect(result).toEqual({ type: "build", label: "Build" });
  });

  it("classifies npm run lint", () => {
    const result = classifyCommand("npm run lint");
    expect(result).toEqual({ type: "lint", label: "ESLint" });
  });

  it("classifies gate tests", () => {
    const result = classifyCommand("npm run test:gates");
    expect(result).toEqual({ type: "gate", label: "Gate testy" });
  });

  it("classifies i18n:check", () => {
    const result = classifyCommand("npm run i18n:check");
    expect(result).toEqual({ type: "i18n", label: "i18n kontrola" });
  });

  it("classifies db:migrate", () => {
    const result = classifyCommand("npm run db:migrate:local");
    expect(result).toEqual({ type: "migration", label: "DB migrace" });
  });

  it("classifies e2e tests", () => {
    const result = classifyCommand("npm run test:e2e:local");
    expect(result).toEqual({ type: "e2e", label: "E2E testy" });
  });

  it("returns null for unrecognized commands", () => {
    expect(classifyCommand("git status")).toBeNull();
    expect(classifyCommand("ls -la")).toBeNull();
    expect(classifyCommand("npm install")).toBeNull();
  });
});

describe("parseTscErrors", () => {
  it("parses TypeScript errors", () => {
    const output = `src/hooks/useMyHook.ts(42,5): error TS2345: Argument of type 'string' is not assignable.
src/lib/utils.ts(10,3): error TS2739: Type '{}' is missing properties.`;

    const errors = parseTscErrors(output);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toEqual({
      file: "src/hooks/useMyHook.ts",
      line: 42,
      message: "Argument of type 'string' is not assignable.",
      raw: "src/hooks/useMyHook.ts(42,5): error TS2345: Argument of type 'string' is not assignable.",
    });
  });

  it("returns empty array for clean output", () => {
    expect(parseTscErrors("")).toEqual([]);
    expect(parseTscErrors("Compilation complete.")).toEqual([]);
  });
});

describe("parseTestErrors", () => {
  it("parses FAIL lines", () => {
    const output = `FAIL  src/tests/hooks/useMyHook.test.ts > should return data`;
    const errors = parseTestErrors(output);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.file).toBe("src/tests/hooks/useMyHook.test.ts");
  });

  it("returns empty for all passing tests", () => {
    const output = `✓ src/tests/hooks/useMyHook.test.ts (3 tests)
Test Files  1 passed (1)
Tests  3 passed (3)`;
    const errors = parseTestErrors(output);
    expect(errors).toEqual([]);
  });
});

describe("parseBuildErrors", () => {
  it("parses generic error lines", () => {
    const output = `error: Build failed with 2 errors`;
    const errors = parseBuildErrors(output);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("parseLintErrors", () => {
  it("parses ESLint error format", () => {
    const output = `  42:5  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any`;
    const errors = parseLintErrors(output);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBe(42);
    expect(errors[0]?.message).toContain("Unexpected any");
  });
});

describe("parseI18nErrors", () => {
  it("parses missing key errors", () => {
    const output = `Missing keys in cs/core.json: common.newFeature, common.newButton`;
    const errors = parseI18nErrors(output);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("parseErrors (dispatch)", () => {
  it("dispatches to parseTscErrors for typecheck", () => {
    const output = `src/test.ts(1,1): error TS0001: test error`;
    const errors = parseErrors(output, "typecheck");
    expect(errors).toHaveLength(1);
  });
});

describe("parseTestSummary", () => {
  it("extracts test summary", () => {
    const output = `Tests 2 failed | 48 passed`;
    const result = parseTestSummary(output);
    expect(result).toEqual({ failures: 2, passed: 48 });
  });

  it("returns null for no summary", () => {
    expect(parseTestSummary("random output")).toBeNull();
  });
});

describe("extractRelevantExcerpt", () => {
  it("extracts from first error line", () => {
    const lines = [
      "Starting build...",
      "Compiling...",
      "error: Something failed",
      "  at file.ts:10",
      "Done.",
    ];
    const result = extractRelevantExcerpt(lines.join("\n"), 3);
    expect(result).toContain("error: Something failed");
    expect(result).not.toContain("Starting build");
  });

  it("returns last lines when no error marker found", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i}`);
    const result = extractRelevantExcerpt(lines.join("\n"), 10);
    expect(result).toContain("Line 49");
    expect(result).not.toContain("Line 0");
  });
});

// ──────────────────────────────────────────
// Edge-case: classifyCommand false positives
// ──────────────────────────────────────────

describe("classifyCommand edge-cases", () => {
  it("does not classify 'npm rebuild' as build (word boundary works)", () => {
    // \bbuild\b correctly rejects "rebuild" — no false positive
    expect(classifyCommand("npm rebuild")).toBeNull();
  });

  it("classifies 'vite build' as build", () => {
    expect(classifyCommand("npx vite build")).toEqual({ type: "build", label: "Build" });
  });

  it("does not classify 'echo test' as test", () => {
    // "test" is only matched by specific patterns, not bare word
    expect(classifyCommand("echo test output")).toBeNull();
  });

  it("gate has priority over generic test", () => {
    const result = classifyCommand("npm run test:gates -- src/tests/gates/emoji.test.ts");
    expect(result?.type).toBe("gate");
  });

  it("e2e has priority over generic test", () => {
    const result = classifyCommand("npm run test:e2e:local");
    expect(result?.type).toBe("e2e");
  });
});

// ──────────────────────────────────────────
// Edge-case: parseLintErrors with filename headers
// ──────────────────────────────────────────

describe("parseLintErrors edge-cases", () => {
  it("parses errors following ESLint filename header", () => {
    const output = `/Users/dev/project/src/hooks/useMyHook.ts
  42:5  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  58:10  error  'x' is defined but never used            @typescript-eslint/no-unused-vars`;
    const errors = parseLintErrors(output);
    expect(errors).toHaveLength(2);
    expect(errors[0]?.line).toBe(42);
    expect(errors[1]?.line).toBe(58);
  });

  it("handles warning lines (skips them — only error)", () => {
    const output = `  10:3  warning  Unexpected console statement  no-console`;
    const errors = parseLintErrors(output);
    expect(errors).toEqual([]);
  });
});

// ──────────────────────────────────────────
// Edge-case: parseBuildErrors Vite rollup format
// ──────────────────────────────────────────

describe("parseBuildErrors edge-cases", () => {
  it("parses Vite/Rollup 'Error:' banner", () => {
    const output = `Error: Build failed with 3 errors`;
    const errors = parseBuildErrors(output);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]?.message).toContain("Build failed");
  });

  it("parses 'error in' format with file and line", () => {
    const output = `ERROR in src/components/Foo.tsx:12\n  Module not found: Can't resolve './Bar'`;
    const errors = parseBuildErrors(output);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it("deduplicates generic errors", () => {
    const output = `error: Duplicate message\nerror: Duplicate message`;
    const errors = parseBuildErrors(output);
    expect(errors).toHaveLength(1);
  });
});

// ──────────────────────────────────────────
// Edge-case: extractRelevantExcerpt
// ──────────────────────────────────────────

describe("extractRelevantExcerpt edge-cases", () => {
  it("handles empty string input", () => {
    const result = extractRelevantExcerpt("", 10);
    expect(result).toBe("");
  });

  it("handles single-line error output", () => {
    const result = extractRelevantExcerpt("FAIL something", 30);
    expect(result).toBe("FAIL something");
  });

  it("respects maxLines limit from error start", () => {
    const lines = [
      "info: compiling",
      "error: first problem",
      "detail line 1",
      "detail line 2",
      "detail line 3",
      "detail line 4",
    ];
    const result = extractRelevantExcerpt(lines.join("\n"), 2);
    const resultLines = result.split("\n");
    expect(resultLines).toHaveLength(2);
    expect(resultLines[0]).toContain("error: first problem");
  });
});

// ──────────────────────────────────────────
// buildTerminalReport — runtime validation
// ──────────────────────────────────────────

describe("buildTerminalReport", () => {
  it("builds a valid report", () => {
    const report = buildTerminalReport({
      commandType: "test",
      commandLabel: "Unit testy",
      success: true,
      errors: [],
      summary: "OK",
      finishedAt: new Date().toISOString(),
    });
    expect(report.commandType).toBe("test");
    expect(report.success).toBe(true);
  });

  it("throws on invalid commandType", () => {
    expect(() =>
      buildTerminalReport({
        commandType: "deploy",
        commandLabel: "Deploy",
        success: true,
        errors: [],
        summary: "OK",
        finishedAt: new Date().toISOString(),
      }),
    ).toThrow();
  });

  it("throws on missing required fields", () => {
    expect(() => buildTerminalReport({})).toThrow();
  });
});
