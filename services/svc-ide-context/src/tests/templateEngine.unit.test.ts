/**
 * Unit tests for templateEngine.ts (Phase 13.1).
 *
 * Covers:
 *   - All 4 supported IDEs render without throwing
 *   - Output includes AISHA-MANAGED-START / AISHA-MANAGED-END delimiters
 *   - Output includes USER-CUSTOM-START / USER-CUSTOM-END delimiters
 *   - Output contains no obvious PII patterns (email, JWT, bearer token)
 *   - JetBrains output is valid JSON
 *   - Empty envelope renders gracefully (no "undefined" / "null" leaks)
 */
import { describe, it, expect } from "vitest";
import {
  renderInstructions,
  SUPPORTED_IDES,
  type SupportedIde,
} from "../lib/templateEngine.js";
import type { WorkspaceContextEnvelope } from "../lib/envelope.js";

const EMPTY_ENVELOPE: WorkspaceContextEnvelope = {
  user_id: "11111111-2222-3333-4444-555555555555",
  workspace_id: null,
  generated_at: "2026-05-19T10:00:00Z",
  is_privileged: false,
  stories: [],
  active_runs: [],
  pending_approvals: [],
  recent_audit: [],
  deploy_state: [],
};

const RICH_ENVELOPE: WorkspaceContextEnvelope = {
  user_id: "11111111-2222-3333-4444-555555555555",
  workspace_id: "local-dev",
  generated_at: "2026-05-19T10:00:00Z",
  is_privileged: true,
  stories: [
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      title: "Stack default",
      status: "in_progress",
      delivery_status: "draft",
      is_stack_default: true,
      default_branch: "main",
      last_activity_at: "2026-05-19T09:00:00Z",
    },
  ],
  active_runs: [
    {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      story_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      kind: "deploy",
      status: "running",
      started_at: "2026-05-19T09:30:00Z",
      current_agent_slug: "orchestrator",
    },
  ],
  pending_approvals: [
    {
      story_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      story_title: "Stack default",
      delivery_status: "awaiting_approval",
      last_activity_at: "2026-05-19T09:45:00Z",
    },
  ],
  recent_audit: [
    {
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      action: "STORY_CREATED",
      severity: "info",
      area: "story",
      summary: "New story created",
      created_at: "2026-05-19T09:00:00Z",
    },
  ],
  deploy_state: [
    {
      app_name: "aisha-app",
      story_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      active_slot: "blue",
      last_switch_at: "2026-05-19T08:00:00Z",
      blue_health: "healthy",
      green_health: "unknown",
    },
  ],
};

// PII regexes for negative assertion — must not appear in rendered output
const PII_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: "email", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  { name: "JWT", pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/ },
  { name: "Bearer token", pattern: /\bBearer\s+[A-Za-z0-9_-]{12,}\b/i },
];

describe("renderInstructions — all IDEs", () => {
  it.each(SUPPORTED_IDES)("renders %s with empty envelope (no crashes, no nullish leak)", (ide) => {
    const out = renderInstructions(ide as SupportedIde, EMPTY_ENVELOPE);
    expect(out.body.length).toBeGreaterThan(20);
    expect(out.body).not.toMatch(/undefined/);
    expect(out.body).not.toMatch(/\bnull\s*$/m);
    expect(out.contentType).toMatch(/^(text\/|application\/json)/);
  });

  it.each(SUPPORTED_IDES)("renders %s with rich envelope and includes story title", (ide) => {
    const out = renderInstructions(ide as SupportedIde, RICH_ENVELOPE);
    expect(out.body).toContain("Stack default");
  });

  it.each(SUPPORTED_IDES.filter((i) => i !== "jetbrains"))(
    "%s output contains AISHA-managed delimiters",
    (ide) => {
      const out = renderInstructions(ide as SupportedIde, EMPTY_ENVELOPE);
      expect(out.body).toContain("<!-- AISHA-MANAGED-START -->");
      expect(out.body).toContain("<!-- AISHA-MANAGED-END -->");
    },
  );

  it.each(SUPPORTED_IDES.filter((i) => i !== "jetbrains"))(
    "%s output contains USER-CUSTOM delimiters",
    (ide) => {
      const out = renderInstructions(ide as SupportedIde, EMPTY_ENVELOPE);
      expect(out.body).toContain("<!-- USER-CUSTOM-START -->");
      expect(out.body).toContain("<!-- USER-CUSTOM-END -->");
    },
  );

  it("JetBrains output is valid JSON with schemaVersion", () => {
    const out = renderInstructions("jetbrains", RICH_ENVELOPE);
    expect(out.contentType).toBe("application/json; charset=utf-8");
    const parsed = JSON.parse(out.body) as { schemaVersion: number };
    expect(parsed.schemaVersion).toBe(1);
  });

  it.each(SUPPORTED_IDES)("%s output contains no obvious PII patterns", (ide) => {
    const out = renderInstructions(ide as SupportedIde, RICH_ENVELOPE);
    for (const { name, pattern } of PII_PATTERNS) {
      expect(out.body, `PII pattern leaked: ${name}`).not.toMatch(pattern);
    }
  });

  it("renderInstructions output is deterministic for same envelope", () => {
    const a = renderInstructions("claude-code", RICH_ENVELOPE);
    const b = renderInstructions("claude-code", RICH_ENVELOPE);
    expect(a.body).toBe(b.body);
  });
});
