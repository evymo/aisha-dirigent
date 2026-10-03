import { TerminalReportSchema } from "./envelope";
import type { TerminalError, TerminalReport } from "./envelope";

export type WatchedCommandType = Exclude<TerminalReport["commandType"], "unknown">;

export interface CommandClassification {
  type: WatchedCommandType;
  label: string;
}

const COMMAND_PATTERNS: Array<{
  pattern: RegExp;
  classification: CommandClassification;
}> = [
  { pattern: /git\s+(?:push|commit)\s+.*--no-verify|git\s+.*--no-verify\s+(?:push|commit)/, classification: { type: "git_bypass", label: "Git --no-verify VIOLATION" } },
  { pattern: /test:gates/, classification: { type: "gate", label: "Gate testy" } },
  { pattern: /test:e2e/, classification: { type: "e2e", label: "E2E testy" } },
  { pattern: /test:run|vitest|jest/, classification: { type: "test", label: "Unit testy" } },
  { pattern: /tsc\b.*--noEmit|typecheck/, classification: { type: "typecheck", label: "TypeScript check" } },
  { pattern: /\blint\b|eslint/, classification: { type: "lint", label: "ESLint" } },
  { pattern: /i18n:check|i18n:segments/, classification: { type: "i18n", label: "i18n kontrola" } },
  { pattern: /db:migrate/, classification: { type: "migration", label: "DB migrace" } },
  { pattern: /\bbuild\b|vite build/, classification: { type: "build", label: "Build" } },
];

export function classifyCommand(commandLine: string): CommandClassification | null {
  for (const { pattern, classification } of COMMAND_PATTERNS) {
    if (pattern.test(commandLine)) return classification;
  }
  return null;
}

export function parseTscErrors(output: string): TerminalError[] {
  const errors: TerminalError[] = [];
  const regex = /^(.+?)\((\d+),(\d+)\):\s*error\s+TS\d+:\s*(.+)$/gm;
  for (const match of output.matchAll(regex)) {
    errors.push({
      file: (match[1] ?? "").trim(),
      line: parseInt(match[2] ?? "0", 10) || undefined,
      message: (match[4] ?? "").trim(),
      raw: match[0],
    });
  }
  return errors;
}

export function parseTestErrors(output: string): TerminalError[] {
  const errors: TerminalError[] = [];

  // eslint-disable-next-line security/detect-unsafe-regex -- input is the developer's OWN local terminal output (Dirigent signals), no adversary in threat model
  const failRegex = /(?:FAIL|×|✗)\s+(.+?)(?:\s+>\s+(.+))?$/gm;
  for (const match of output.matchAll(failRegex)) {
    errors.push({
      file: (match[1] ?? "").trim(),
      message: (match[2] ?? "Test failed").trim(),
      raw: match[0],
    });
  }

  const assertRegex =
    // eslint-disable-next-line security/detect-unsafe-regex -- input is the developer's OWN local terminal output (Dirigent signals), no adversary in threat model
    /(?:AssertionError|Error):\s*(.+?)(?:\n\s*at\s+(.+?)\s*\((.+?):(\d+):\d+\))?/g;
  for (const match of output.matchAll(assertRegex)) {
    const message = (match[1] ?? "").trim();
    if (!message) continue;
    if (!errors.some((e) => e.message === message)) {
      const lineRaw = (match[4] ?? "").trim();
      const line = lineRaw ? parseInt(lineRaw, 10) : undefined;
      errors.push({
        file: (match[3] ?? "").trim() || undefined,
        line: line && Number.isFinite(line) ? line : undefined,
        message,
        raw: match[0],
      });
    }
  }

  return errors;
}

export function parseTestSummary(output: string): { failures: number; passed: number } | null {
  const summaryRegex = /Tests?\s+(\d+)\s+failed\s*\|\s*(\d+)\s+passed/;
  const match = output.match(summaryRegex);
  if (!match) return null;
  return {
    failures: parseInt(match[1] ?? "0", 10),
    passed: parseInt(match[2] ?? "0", 10),
  };
}

export function parseBuildErrors(output: string): TerminalError[] {
  const errors: TerminalError[] = [];

  // eslint-disable-next-line security/detect-unsafe-regex -- input is the developer's OWN local terminal output (Dirigent signals), no adversary in threat model
  const viteRegex = /(?:ERROR|error)\s+(?:in\s+)?(.+?):(\d+)(?::(\d+))?\s*\n\s*(.+)/g;
  for (const match of output.matchAll(viteRegex)) {
    errors.push({
      file: (match[1] ?? "").trim(),
      line: parseInt(match[2] ?? "0", 10) || undefined,
      message: (match[4] ?? "").trim(),
      raw: match[0],
    });
  }

  const genericRegex = /^(?:error|Error):\s*(.+)$/gm;
  for (const match of output.matchAll(genericRegex)) {
    const message = (match[1] ?? "").trim();
    if (!message) continue;
    if (!errors.some((e) => e.message === message)) {
      errors.push({ message, raw: match[0] });
    }
  }

  return errors;
}

export function parseLintErrors(output: string): TerminalError[] {
  const errors: TerminalError[] = [];
  const regex = /^\s+(\d+):(\d+)\s+error\s+(.+?)\s{2,}(\S+)$/gm;
  for (const match of output.matchAll(regex)) {
    const line = parseInt(match[1] ?? "0", 10) || undefined;
    const message = `${(match[3] ?? "").trim()} (${(match[4] ?? "").trim()})`.trim();
    if (!message) continue;
    errors.push({ line, message, raw: match[0] });
  }
  return errors;
}

export function parseI18nErrors(output: string): TerminalError[] {
  const errors: TerminalError[] = [];
  const regex =
    // eslint-disable-next-line security/detect-unsafe-regex -- input is the developer's OWN local terminal output (Dirigent signals), no adversary in threat model
    /(?:Missing|MISSING|missing)\s+(?:key|translation)s?\s*(?:in\s+)?(\S+)?[:\s]+(.+)/gi;
  for (const match of output.matchAll(regex)) {
    const message = (match[2] ?? "").trim();
    if (!message) continue;
    errors.push({
      file: (match[1] ?? "").trim() || undefined,
      message,
      raw: match[0],
    });
  }
  return errors;
}

export function parseErrors(output: string, commandType: WatchedCommandType): TerminalError[] {
  switch (commandType) {
    case "typecheck":
      return parseTscErrors(output);
    case "test":
    case "gate":
    case "e2e":
      return parseTestErrors(output);
    case "build":
      return parseBuildErrors(output);
    case "lint":
      return parseLintErrors(output);
    case "i18n":
      return parseI18nErrors(output);
    case "migration":
      return parseBuildErrors(output);
  }
}

export function extractRelevantExcerpt(output: string, maxLines: number = 30): string {
  const lines = output.split("\n");
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/(?:FAIL|error|Error|FAILED|✗|×)\b/i.test(lines[i] ?? "")) {
      startIdx = i;
      break;
    }
  }

  if (startIdx >= 0) return lines.slice(startIdx, startIdx + maxLines).join("\n");
  return lines.slice(-maxLines).join("\n");
}

/**
 * Build a validated TerminalReport from raw input.
 *
 * Wraps `TerminalReportSchema.parse()` to guarantee runtime type safety.
 * Use this instead of constructing `TerminalReport` as a plain object.
 */
export function buildTerminalReport(input: Record<string, unknown>): TerminalReport {
  return TerminalReportSchema.parse(input);
}

