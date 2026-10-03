import { describe, it, expect } from "vitest";
import {
  TerminalReportSchema,
  TerminalErrorSchema,
  LocalTaskEnvelopeSchema,
  LocalDiagnosticSchema,
  LocalRangeSchema,
  GitSummarySchema,
  DashboardSnapshotSchema,
  parseLocalTaskEnvelope,
} from "../envelope";

// ──────────────────────────────────────────
// TerminalErrorSchema
// ──────────────────────────────────────────

describe("TerminalErrorSchema", () => {
  it("parses a full error object", () => {
    const input = {
      file: "src/hooks/useMyHook.ts",
      line: 42,
      message: "Argument of type 'string' is not assignable.",
      raw: "src/hooks/useMyHook.ts(42,5): error TS2345: ...",
    };
    const result = TerminalErrorSchema.parse(input);
    expect(result.file).toBe("src/hooks/useMyHook.ts");
    expect(result.line).toBe(42);
  });

  it("accepts error with only required fields", () => {
    const result = TerminalErrorSchema.parse({
      message: "Something failed",
      raw: "error: Something failed",
    });
    expect(result.file).toBeUndefined();
    expect(result.line).toBeUndefined();
    expect(result.message).toBe("Something failed");
  });

  it("rejects empty message", () => {
    expect(() =>
      TerminalErrorSchema.parse({ message: "", raw: "x" }),
    ).toThrow();
  });

  it("rejects empty raw", () => {
    expect(() =>
      TerminalErrorSchema.parse({ message: "ok", raw: "" }),
    ).toThrow();
  });

  it("rejects non-integer line", () => {
    expect(() =>
      TerminalErrorSchema.parse({ message: "ok", raw: "ok", line: 1.5 }),
    ).toThrow();
  });

  it("rejects negative line", () => {
    expect(() =>
      TerminalErrorSchema.parse({ message: "ok", raw: "ok", line: -1 }),
    ).toThrow();
  });
});

// ──────────────────────────────────────────
// TerminalReportSchema
// ──────────────────────────────────────────

describe("TerminalReportSchema", () => {
  const validReport = {
    commandType: "test",
    commandLabel: "Unit testy",
    commandLine: "npm run test:run",
    exitCode: 1,
    success: false,
    errors: [{ message: "Test failed", raw: "FAIL ..." }],
    summary: "1 chyb detekováno",
    testFailures: 1,
    testPassed: 42,
    rawExcerpt: "FAIL src/tests/...",
    finishedAt: "2026-03-30T12:00:00.000Z",
  };

  it("parses a valid report", () => {
    const result = TerminalReportSchema.parse(validReport);
    expect(result.commandType).toBe("test");
    expect(result.errors).toHaveLength(1);
    expect(result.testPassed).toBe(42);
  });

  it("parses a minimal success report", () => {
    const result = TerminalReportSchema.parse({
      commandType: "build",
      commandLabel: "Build",
      success: true,
      errors: [],
      summary: "OK",
      finishedAt: "2026-03-30T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
    expect(result.exitCode).toBeUndefined();
    expect(result.testFailures).toBeUndefined();
  });

  it("accepts all commandType values", () => {
    const types = ["test", "build", "typecheck", "lint", "gate", "i18n", "migration", "e2e", "unknown"] as const;
    for (const type of types) {
      const result = TerminalReportSchema.parse({
        ...validReport,
        commandType: type,
      });
      expect(result.commandType).toBe(type);
    }
  });

  it("rejects invalid commandType", () => {
    expect(() =>
      TerminalReportSchema.parse({ ...validReport, commandType: "deploy" }),
    ).toThrow();
  });

  it("rejects missing commandLabel", () => {
    const { commandLabel: _, ...noLabel } = validReport;
    expect(() => TerminalReportSchema.parse(noLabel)).toThrow();
  });

  it("rejects empty commandLabel", () => {
    expect(() =>
      TerminalReportSchema.parse({ ...validReport, commandLabel: "" }),
    ).toThrow();
  });

  it("rejects missing finishedAt", () => {
    const { finishedAt: _, ...noFinished } = validReport;
    expect(() => TerminalReportSchema.parse(noFinished)).toThrow();
  });

  it("rejects non-datetime finishedAt", () => {
    expect(() =>
      TerminalReportSchema.parse({ ...validReport, finishedAt: "not-a-date" }),
    ).toThrow();
  });

  it("rejects negative testFailures", () => {
    expect(() =>
      TerminalReportSchema.parse({ ...validReport, testFailures: -1 }),
    ).toThrow();
  });

  it("rejects errors with invalid items", () => {
    expect(() =>
      TerminalReportSchema.parse({
        ...validReport,
        errors: [{ message: "", raw: "" }],
      }),
    ).toThrow();
  });
});

// ──────────────────────────────────────────
// LocalDiagnosticSchema
// ──────────────────────────────────────────

describe("LocalDiagnosticSchema", () => {
  it("parses a full diagnostic", () => {
    const result = LocalDiagnosticSchema.parse({
      file: "src/App.tsx",
      severity: "error",
      message: "Cannot find name 'x'",
      source: "typescript",
      code: "TS2304",
      range: { startLine: 10, startCharacter: 0, endLine: 10, endCharacter: 5 },
    });
    expect(result.file).toBe("src/App.tsx");
    expect(result.range?.startLine).toBe(10);
  });

  it("accepts minimal diagnostic", () => {
    const result = LocalDiagnosticSchema.parse({
      file: "a.ts",
      severity: "warning",
      message: "Unused variable",
    });
    expect(result.source).toBeUndefined();
    expect(result.code).toBeUndefined();
    expect(result.range).toBeUndefined();
  });

  it("rejects empty file", () => {
    expect(() =>
      LocalDiagnosticSchema.parse({ file: "", severity: "info", message: "x" }),
    ).toThrow();
  });

  it("rejects invalid severity", () => {
    expect(() =>
      LocalDiagnosticSchema.parse({ file: "a.ts", severity: "fatal", message: "x" }),
    ).toThrow();
  });
});

// ──────────────────────────────────────────
// LocalRangeSchema
// ──────────────────────────────────────────

describe("LocalRangeSchema", () => {
  it("parses valid range", () => {
    const result = LocalRangeSchema.parse({
      startLine: 0,
      startCharacter: 0,
      endLine: 10,
      endCharacter: 5,
    });
    expect(result.endLine).toBe(10);
  });

  it("rejects negative values", () => {
    expect(() =>
      LocalRangeSchema.parse({
        startLine: -1,
        startCharacter: 0,
        endLine: 0,
        endCharacter: 0,
      }),
    ).toThrow();
  });

  it("rejects float values", () => {
    expect(() =>
      LocalRangeSchema.parse({
        startLine: 1.5,
        startCharacter: 0,
        endLine: 2,
        endCharacter: 0,
      }),
    ).toThrow();
  });
});

// ──────────────────────────────────────────
// GitSummarySchema
// ──────────────────────────────────────────

describe("GitSummarySchema", () => {
  it("parses full git summary", () => {
    const result = GitSummarySchema.parse({
      branch: "feat/signals",
      aheadBy: 2,
      behindBy: 0,
      changedFiles: [
        { path: "src/index.ts", status: "modified" },
        { path: "new-file.ts", status: "added" },
      ],
      hasUncommittedChanges: true,
      capturedAt: "2026-03-30T12:00:00.000Z",
    });
    expect(result.changedFiles).toHaveLength(2);
    expect(result.branch).toBe("feat/signals");
  });

  it("defaults changedFiles to empty array", () => {
    const result = GitSummarySchema.parse({
      hasUncommittedChanges: false,
      capturedAt: "2026-03-30T12:00:00.000Z",
    });
    expect(result.changedFiles).toEqual([]);
  });

  it("rejects invalid file status", () => {
    expect(() =>
      GitSummarySchema.parse({
        changedFiles: [{ path: "a.ts", status: "corrupted" }],
        hasUncommittedChanges: false,
        capturedAt: "2026-03-30T12:00:00.000Z",
      }),
    ).toThrow();
  });
});

// ──────────────────────────────────────────
// DashboardSnapshotSchema
// ──────────────────────────────────────────

describe("DashboardSnapshotSchema", () => {
  it("parses full snapshot", () => {
    const result = DashboardSnapshotSchema.parse({
      surface: "appsmith",
      appId: "app-123",
      pageId: "page-1",
      pageName: "Dashboard",
      activeView: "table",
      filters: { status: "active" },
      lastQueryErrors: [
        { name: "getUsers", message: "Timeout", severity: "error" },
      ],
      capturedAt: "2026-03-30T12:00:00.000Z",
    });
    expect(result.surface).toBe("appsmith");
    expect(result.lastQueryErrors).toHaveLength(1);
  });

  it("defaults surface to unknown", () => {
    const result = DashboardSnapshotSchema.parse({
      capturedAt: "2026-03-30T12:00:00.000Z",
    });
    expect(result.surface).toBe("unknown");
  });

  it("defaults query error severity to error", () => {
    const result = DashboardSnapshotSchema.parse({
      lastQueryErrors: [{ name: "q", message: "fail" }],
      capturedAt: "2026-03-30T12:00:00.000Z",
    });
    expect(result.lastQueryErrors?.[0]?.severity).toBe("error");
  });
});

// ──────────────────────────────────────────
// LocalTaskEnvelopeSchema + parseLocalTaskEnvelope
// ──────────────────────────────────────────

describe("LocalTaskEnvelopeSchema", () => {
  const minimalEnvelope = {
    version: "2026-03-30",
    createdAt: "2026-03-30T12:00:00.000Z",
  };

  it("parses minimal envelope with defaults", () => {
    const result = LocalTaskEnvelopeSchema.parse(minimalEnvelope);
    expect(result.version).toBe("2026-03-30");
    expect(result.actor.kind).toBe("unknown");
    expect(result.intent.kind).toBe("unknown");
    expect(result.signals.diagnostics).toEqual([]);
    expect(result.signals.terminal).toEqual([]);
    expect(result.redaction.policy).toBe("safe_excerpt");
    expect(result.redaction.notes).toEqual([]);
  });

  it("parses a fully populated envelope", () => {
    const full = {
      version: "2026-03-30",
      createdAt: "2026-03-30T12:00:00.000Z",
      workspaceId: "ws-abc",
      workspaceRoot: "/home/user/project",
      storyId: "story-123",
      actor: { kind: "vscode_extension", sessionId: "sess-1" },
      intent: { kind: "terminal", prompt: "Fix test errors" },
      signals: {
        diagnostics: [
          { file: "a.ts", severity: "error", message: "err" },
        ],
        terminal: [
          {
            commandType: "test",
            commandLabel: "Unit testy",
            success: false,
            errors: [{ message: "fail", raw: "FAIL" }],
            summary: "1 error",
            finishedAt: "2026-03-30T12:00:00.000Z",
          },
        ],
        git: {
          hasUncommittedChanges: true,
          capturedAt: "2026-03-30T12:00:00.000Z",
        },
        dashboard: {
          surface: "storyloop",
          capturedAt: "2026-03-30T12:00:00.000Z",
        },
      },
      redaction: {
        policy: "metadata_only",
        notes: ["Removed raw output for privacy"],
      },
    };
    const result = LocalTaskEnvelopeSchema.parse(full);
    expect(result.actor.kind).toBe("vscode_extension");
    expect(result.signals.terminal).toHaveLength(1);
    expect(result.signals.git?.hasUncommittedChanges).toBe(true);
    expect(result.signals.dashboard?.surface).toBe("storyloop");
    expect(result.redaction.policy).toBe("metadata_only");
  });

  it("rejects wrong version literal", () => {
    expect(() =>
      LocalTaskEnvelopeSchema.parse({ ...minimalEnvelope, version: "2025-01-01" }),
    ).toThrow();
  });

  it("rejects missing createdAt", () => {
    expect(() =>
      LocalTaskEnvelopeSchema.parse({ version: "2026-03-30" }),
    ).toThrow();
  });

  it("rejects invalid actor kind", () => {
    expect(() =>
      LocalTaskEnvelopeSchema.parse({
        ...minimalEnvelope,
        actor: { kind: "jetbrains_plugin" },
      }),
    ).toThrow();
  });

  it("rejects invalid intent kind", () => {
    expect(() =>
      LocalTaskEnvelopeSchema.parse({
        ...minimalEnvelope,
        intent: { kind: "webhook" },
      }),
    ).toThrow();
  });
});

describe("parseLocalTaskEnvelope", () => {
  it("parses valid input", () => {
    const result = parseLocalTaskEnvelope({
      version: "2026-03-30",
      createdAt: "2026-03-30T12:00:00.000Z",
    });
    expect(result.version).toBe("2026-03-30");
    expect(result.signals.terminal).toEqual([]);
  });

  it("throws on completely invalid input", () => {
    expect(() => parseLocalTaskEnvelope(null)).toThrow();
    expect(() => parseLocalTaskEnvelope("not an object")).toThrow();
    expect(() => parseLocalTaskEnvelope(42)).toThrow();
  });

  it("throws on missing required fields", () => {
    expect(() => parseLocalTaskEnvelope({})).toThrow();
    expect(() =>
      parseLocalTaskEnvelope({ version: "2026-03-30" }),
    ).toThrow();
  });
});
