import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");

const SCAN_DIRS = [
  path.join(ROOT, "src"),
  path.join(ROOT, "mobile-app/src"),
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

const EXCLUDED_PATH_PARTS = [
  `${path.sep}tests${path.sep}`,
  `${path.sep}__tests__${path.sep}`,
  ".test.",
  ".spec.",
  `${path.sep}src${path.sep}integrations${path.sep}db${path.sep}types.ts`,
  `${path.sep}mobile-app${path.sep}src${path.sep}types${path.sep}supabase.ts`,
  `${path.sep}archive${path.sep}edge-functions-reference${path.sep}`,
];

const NON_DB_FROM_RECEIVERS = new Set(["Array", "Uint8Array", "Buffer"]);

/**
 * Edge functions running as service_role may insert directly into audit_journal
 * because there is no RPC wrapper for service-level audit logging from Deno.
 *
 * Some internal service-role edge functions also still access a limited set of
 * operational tables directly. Keep the exception list explicit so new direct
 * table access does not slip in unnoticed.
 */
const EDGE_FUNCTION_ALLOWED_TABLES = new Set([
  "ai_eval_runs",
  "ai_golden_examples",
  "audit_journal",
  "blockchain_audit_records",
  "call_participants",
  "chat_messages",
  "consultation_sessions",
  "expert_rules",
  "github_app_installations",
  "github_app_repositories",
  "knowledge_chunks",
  "knowledge_embeddings",
  "knowledge_items",
  "knowledge_post_translations",
  "knowledge_topic_translations",
  "notifications",
  "partner_stories",
  "profiles",
  "reward_claims",
  "shipment_settings",
  "story_members",
  "supported_languages",
  "token_transactions",
  "voice_rooms",
]);

/**
 * Mobile app hooks that access tables directly where RPC wrappers
 * don't exist yet. Keep this list explicit and minimal.
 */
const MOBILE_APP_ALLOWED_TABLES = new Set([
  "token_transactions",
]);

type FromCall = {
  line: number;
  receiver: string;
  target: string;
};

function shouldSkipFile(filePath: string): boolean {
  return EXCLUDED_PATH_PARTS.some((part) => filePath.includes(part));
}

function collectSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    if (shouldSkipFile(fullPath)) continue;
    files.push(fullPath);
  }

  return files;
}

function findFromCalls(content: string): FromCall[] {
  const calls: FromCall[] = [];
  const fromCallPattern =
    /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\.from\s*\(\s*(['"`])([^'"`]+)\2\s*\)/g;

  let match: RegExpExecArray | null = fromCallPattern.exec(content);
  while (match !== null) {
    const line = content.substring(0, match.index).split("\n").length;
    calls.push({
      line,
      receiver: match[1],
      target: match[3],
    });
    match = fromCallPattern.exec(content);
  }

  return calls;
}

function isAllowedFromCall(call: FromCall, filePath: string): boolean {
  if (NON_DB_FROM_RECEIVERS.has(call.receiver)) {
    return true;
  }

  if (call.receiver === "storage" || call.receiver.endsWith(".storage")) {
    return true;
  }

  if (
    filePath.includes(`${path.sep}supabase${path.sep}functions${path.sep}`) &&
    EDGE_FUNCTION_ALLOWED_TABLES.has(call.target)
  ) {
    return true;
  }

  if (
    filePath.includes(`${path.sep}mobile-app${path.sep}`) &&
    MOBILE_APP_ALLOWED_TABLES.has(call.target)
  ) {
    return true;
  }

  return false;
}

/**
 * Components that are allowed to call supabase.rpc() directly.
 * Each entry MUST have a technical justification comment.
 */
const COMPONENT_RPC_ALLOWLIST = new Set([
  // OccipitumDesignPanel: fire-and-forget personality signal capture
  // during design interaction — extracting to a hook is tracked as backlog.
  "src/components/storyloop/OccipitumDesignPanel.tsx",
]);

function findDirectRpcCalls(content: string): Array<{ line: number; snippet: string }> {
  const results: Array<{ line: number; snippet: string }> = [];
  const rpcPattern = /supabase\s*\.\s*rpc\s*\(/g;
  let match: RegExpExecArray | null = rpcPattern.exec(content);
  while (match !== null) {
    const line = content.substring(0, match.index).split("\n").length;
    results.push({ line, snippet: match[0] });
    match = rpcPattern.exec(content);
  }
  return results;
}

describe("RPC-only data access (web + mobile + edge)", () => {
  it("does not allow direct .from(\"table\") outside approved exceptions", () => {
    const sourceFiles = SCAN_DIRS.flatMap((dir) => collectSourceFiles(dir));
    const violations: string[] = [];

    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, "utf-8");
      const calls = findFromCalls(content);

      for (const call of calls) {
        if (isAllowedFromCall(call, file)) continue;

        const relativePath = path.relative(ROOT, file);
        violations.push(
          `${relativePath}:${call.line} ${call.receiver}.from("${call.target}")`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it("components and pages do not call supabase.rpc() directly (must use hooks)", () => {
    const componentDirs = [
      path.join(ROOT, "src/components"),
      path.join(ROOT, "src/pages"),
    ];

    const sourceFiles = componentDirs.flatMap((dir) => collectSourceFiles(dir));
    const violations: string[] = [];

    for (const file of sourceFiles) {
      const relativePath = path.relative(ROOT, file);
      if (COMPONENT_RPC_ALLOWLIST.has(relativePath)) continue;

      const content = fs.readFileSync(file, "utf-8");
      const rpcCalls = findDirectRpcCalls(content);

      for (const call of rpcCalls) {
        violations.push(`${relativePath}:${call.line} ${call.snippet}`);
      }
    }

    expect(
      violations,
      `Components/pages call supabase.rpc() directly (must use hooks):\n${violations.join("\n")}`,
    ).toEqual([]);
  });
});
