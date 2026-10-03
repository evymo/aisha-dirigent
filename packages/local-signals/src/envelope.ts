import { z } from "zod";

export const LocalSignalsVersionSchema = z.literal("2026-03-30");
export type LocalSignalsVersion = z.infer<typeof LocalSignalsVersionSchema>;

export const LocalSignalSeveritySchema = z.enum(["info", "warning", "error"]);
export type LocalSignalSeverity = z.infer<typeof LocalSignalSeveritySchema>;

/** @experimental Used by LocalDiagnostic — not yet wired in consumers. */
export const LocalRangeSchema = z.object({
  startLine: z.number().int().nonnegative(),
  startCharacter: z.number().int().nonnegative(),
  endLine: z.number().int().nonnegative(),
  endCharacter: z.number().int().nonnegative(),
});
export type LocalRange = z.infer<typeof LocalRangeSchema>;

/** @experimental Planned for auto-flow diagnostic signal transport. */
export const LocalDiagnosticSchema = z.object({
  file: z.string().min(1),
  severity: LocalSignalSeveritySchema,
  message: z.string().min(1),
  source: z.string().optional(),
  code: z.union([z.string(), z.number()]).optional(),
  range: LocalRangeSchema.optional(),
});
export type LocalDiagnostic = z.infer<typeof LocalDiagnosticSchema>;

export const TerminalErrorSchema = z.object({
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  message: z.string().min(1),
  raw: z.string().min(1),
});
export type TerminalError = z.infer<typeof TerminalErrorSchema>;

export const TerminalReportSchema = z.object({
  commandType: z.enum([
    "test",
    "build",
    "typecheck",
    "lint",
    "gate",
    "i18n",
    "migration",
    "e2e",
    "git_bypass",
    "unknown",
  ]),
  commandLabel: z.string().min(1),
  commandLine: z.string().optional(),
  exitCode: z.number().int().optional(),
  success: z.boolean(),
  errors: z.array(TerminalErrorSchema),
  summary: z.string().min(1),
  testFailures: z.number().int().nonnegative().optional(),
  testPassed: z.number().int().nonnegative().optional(),
  rawExcerpt: z.string().optional(),
  finishedAt: z.string().datetime(),
});
export type TerminalReport = z.infer<typeof TerminalReportSchema>;

/** @experimental Planned for git signal layer in LocalTaskEnvelope. */
export const GitChangedFileSchema = z.object({
  path: z.string().min(1),
  status: z.enum(["added", "modified", "deleted", "renamed", "untracked", "unknown"]),
});
export type GitChangedFile = z.infer<typeof GitChangedFileSchema>;

/** @experimental Planned for git signal layer in LocalTaskEnvelope. */
export const GitSummarySchema = z.object({
  branch: z.string().optional(),
  aheadBy: z.number().int().nonnegative().optional(),
  behindBy: z.number().int().nonnegative().optional(),
  changedFiles: z.array(GitChangedFileSchema).default([]),
  hasUncommittedChanges: z.boolean(),
  capturedAt: z.string().datetime(),
});
export type GitSummary = z.infer<typeof GitSummarySchema>;

/** @experimental Planned for Appsmith/Storyloop dashboard signal transport. */
export const DashboardSnapshotSchema = z.object({
  surface: z.enum(["appsmith", "storyloop", "custom", "unknown"]).default("unknown"),
  appId: z.string().optional(),
  pageId: z.string().optional(),
  pageName: z.string().optional(),
  activeView: z.string().optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  lastQueryErrors: z
    .array(
      z.object({
        name: z.string().min(1),
        message: z.string().min(1),
        severity: LocalSignalSeveritySchema.default("error"),
      }),
    )
    .optional(),
  capturedAt: z.string().datetime(),
});
export type DashboardSnapshot = z.infer<typeof DashboardSnapshotSchema>;

/** @experimental Master envelope — will wrap all signal types for backend transport. */
export const LocalTaskEnvelopeSchema = z.object({
  version: LocalSignalsVersionSchema,
  createdAt: z.string().datetime(),

  workspaceId: z.string().optional(),
  workspaceRoot: z.string().optional(),

  storyId: z.string().optional(),
  actor: z
    .object({
      kind: z.enum(["vscode_extension", "code_oss_shell", "cli", "unknown"]).default("unknown"),
      sessionId: z.string().optional(),
    })
    .default({ kind: "unknown" }),

  intent: z
    .object({
      kind: z.enum(["chat", "autoflow", "terminal", "diagnostics", "dashboard", "unknown"]).default("unknown"),
      prompt: z.string().optional(),
    })
    .default({ kind: "unknown" }),

  signals: z
    .object({
      diagnostics: z.array(LocalDiagnosticSchema).default([]),
      terminal: z.array(TerminalReportSchema).default([]),
      git: GitSummarySchema.optional(),
      dashboard: DashboardSnapshotSchema.optional(),
    })
    .default({ diagnostics: [], terminal: [] }),

  redaction: z
    .object({
      policy: z.enum(["metadata_only", "safe_excerpt"]).default("safe_excerpt"),
      notes: z.array(z.string()).default([]),
    })
    .default({ policy: "safe_excerpt", notes: [] }),
});

export type LocalTaskEnvelope = z.infer<typeof LocalTaskEnvelopeSchema>;

export function parseLocalTaskEnvelope(raw: unknown): LocalTaskEnvelope {
  return LocalTaskEnvelopeSchema.parse(raw);
}

