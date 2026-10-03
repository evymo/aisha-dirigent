/**
 * Component render tests for the agent-activity + spend-governance surfacing.
 *
 * This is the FRONTEND half of the two-sided verification: given the exact data
 * shape the backend RPCs return (list_active_agent_sessions,
 * list_pending_spend_approvals, get_agent_phase_catalog) — verified to execute
 * on real Postgres by the throwaway RPC smoke — assert the React components
 * render it with the data-test selectors and content the workbench/Playwright
 * specs target. Live auth+realtime integration is exercised by
 * e2e/workbench-surfacing.spec.ts on a full stack; this covers the render
 * contract deterministically in jsdom.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, configure } from "@testing-library/react";

import { customRender } from "@/tests/utils/test-utils";

// The codebase tags elements with `data-test`, not RTL's default `data-testid`.
configure({ testIdAttribute: "data-test" });

// ── i18n: return the provided default string (2nd arg) so text is assertable ──
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: unknown) => {
      if (typeof opts === "string") return opts; // t(key, "Default")
      if (opts && typeof opts === "object" && "defaultValue" in opts) {
        return String((opts as { defaultValue: unknown }).defaultValue);
      }
      return key;
    },
    i18n: { language: "en" },
  }),
  Trans: ({ children }: { children?: unknown }) => children ?? null,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// ── db client: rpc dispatched by fn name + a no-op realtime channel ──
const rpcMock = vi.fn();
const channelStub = { on: () => channelStub, subscribe: () => channelStub };
vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    channel: () => channelStub,
    removeChannel: vi.fn(),
  },
}));

import userEvent from "@testing-library/user-event";
import { useSpawnClaudeRun } from "@/hooks/useSpawnClaudeRun";
import { AgentSessionsStrip } from "@/components/admin/mission-control/AgentSessionsStrip";
import { SpendApprovalPending } from "@/components/admin/mission-control/SpendApprovalPending";
import { ClaudeRunApprovalsPending } from "@/components/admin/mission-control/ClaudeRunApprovalsPending";
import { KanbanCard } from "@/components/admin/kanban/KanbanCard";

const SESSION = {
  session_id: "e2e-sess-1",
  source: "claude-code",
  story_id: "00000000-0000-0000-0000-0000000000aa",
  story_title: "Checkout refactor",
  user_id: null,
  agent_run_id: null,
  ai_run_id: "00000000-0000-0000-0000-0000000000bb",
  branch: "feat/x",
  current_phase: "tool_use",
  phase_detail: null,
  current_task: null,
  last_tool: "Edit",
  last_file: "src/foo.ts",
  subagents: [{ label: "reviewer", status: "running", started_at: null, ended_at: null }],
  tokens_estimate: null,
  tokens_input: 1200,
  tokens_output: 800,
  cost: 0.42,
  started_at: new Date(Date.now() - 90_000).toISOString(),
  updated_at: new Date().toISOString(),
  elapsed_ms: 90_000,
};

const PHASE_CATALOG = [
  { slug: "tool_use", axis: "activity", labels: { en: "tool use", cs: "pracuje" }, sort_order: 2 },
];

const APPROVAL = {
  run_id: "00000000-0000-0000-0000-0000000000cc",
  kind: "project_delivery",
  story_id: "00000000-0000-0000-0000-0000000000aa",
  story_title: "Checkout refactor",
  requested_at: new Date(Date.now() - 120_000).toISOString(),
  age_ms: 120_000,
  estimate: 12.5,
  decision_reason: "estimate 12.5 > ask threshold 5",
  authorization_json: { decision: "ask" },
};

function dispatch(map: Record<string, unknown[]>) {
  rpcMock.mockImplementation(((fn: string) =>
    Promise.resolve({ data: map[fn] ?? [], error: null })) as never);
}

beforeEach(() => rpcMock.mockReset());

describe("AgentSessionsStrip — renders live agent sessions", () => {
  it("shows the strip, the seeded session row, source, phase label and cost", async () => {
    dispatch({
      list_active_agent_sessions: [SESSION],
      get_agent_phase_catalog: PHASE_CATALOG,
    });
    customRender(<AgentSessionsStrip />);

    expect(await screen.findByTestId("mc-agent-sessions-strip")).toBeInTheDocument();
    expect(await screen.findByTestId(`agent-session-${SESSION.session_id}`)).toBeInTheDocument();
    // story title + source chip + catalog-driven phase label + token rollup
    expect(screen.getByText("Checkout refactor")).toBeInTheDocument();
    expect(screen.getByText("claude-code")).toBeInTheDocument();
    expect(screen.getByText("tool use")).toBeInTheDocument(); // from PHASE_CATALOG
  });

  it("renders the empty state when no sessions", async () => {
    dispatch({ list_active_agent_sessions: [], get_agent_phase_catalog: PHASE_CATALOG });
    customRender(<AgentSessionsStrip />);
    expect(await screen.findByTestId("mc-agent-sessions-strip")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("No active sessions.")).toBeInTheDocument(),
    );
  });

  it("exposes the Component-4 producer surface (spawn Claude run button)", async () => {
    dispatch({ list_active_agent_sessions: [], get_agent_phase_catalog: PHASE_CATALOG });
    customRender(<AgentSessionsStrip />);
    expect(await screen.findByTestId("spawn-claude-run")).toBeInTheDocument();
  });
});

describe("E10 producer — useSpawnClaudeRun", () => {
  // Inline harness avoids Radix portal flakiness; tests the producer logic.
  function SpawnHarness() {
    const spawn = useSpawnClaudeRun();
    return (
      <button data-test="harness-spawn" onClick={() => spawn.mutate({ prompt: "Refactor checkout", storyId: "story-1" })}>
        go
      </button>
    );
  }

  it("spawns via fn_spawn_claude_cli_run with story-scoped inputs, image omitted", async () => {
    const user = userEvent.setup();
    dispatch({ fn_spawn_claude_cli_run: "run-uuid-xyz" as unknown as unknown[] });
    customRender(<SpawnHarness />);
    await user.click(screen.getByTestId("harness-spawn"));
    await waitFor(() => {
      const call = rpcMock.mock.calls.find((c) => c[0] === "fn_spawn_claude_cli_run");
      expect(call).toBeDefined();
      const args = call![1] as { p_image: string; p_source: string; p_inputs: Record<string, unknown> };
      expect(args.p_image).toBe(""); // runner defaults the image
      expect(args.p_source).toBe("dirigent:ui");
      expect(args.p_inputs.prompt).toBe("Refactor checkout");
      expect(args.p_inputs.story_id).toBe("story-1");
      expect(args.p_inputs.auth_mode).toBe("auto");
    });
  });
});

describe("SpendApprovalPending — renders blocked spend runs", () => {
  it("shows the pane, the approval row, kind, estimate and reason", async () => {
    dispatch({ list_pending_spend_approvals: [APPROVAL] });
    customRender(<SpendApprovalPending />);

    expect(await screen.findByTestId("mc-spend-approval-pending")).toBeInTheDocument();
    expect(await screen.findByTestId(`spend-approval-${APPROVAL.run_id}`)).toBeInTheDocument();
    expect(screen.getByText("project_delivery")).toBeInTheDocument();
    expect(screen.getByText(/~\$12\.50/)).toBeInTheDocument();
  });
});

const CLAUDE_APPROVAL = {
  run_id: "00000000-0000-0000-0000-0000000000dd",
  story_id: "00000000-0000-0000-0000-0000000000aa",
  source: "dirigent:test",
  awaiting: "risk_approval",
  decision_id: "00000000-0000-0000-0000-0000000000ee",
  risk_level: "critical",
  requested_by: null,
  created_at: new Date(Date.now() - 60_000).toISOString(),
};

describe("ClaudeRunApprovalsPending — renders held CLI runs + approve action", () => {
  it("shows the pane, the held run, its awaiting reason + risk", async () => {
    dispatch({ list_pending_claude_approvals: [CLAUDE_APPROVAL] });
    customRender(<ClaudeRunApprovalsPending />);

    expect(await screen.findByTestId("mc-cli-approvals")).toBeInTheDocument();
    expect(await screen.findByTestId(`cli-approval-${CLAUDE_APPROVAL.run_id}`)).toBeInTheDocument();
    expect(screen.getByText("risk_approval")).toBeInTheDocument();
    expect(screen.getByText("critical")).toBeInTheDocument();
  });

  it("Approve calls approve_claude_run with the run id", async () => {
    dispatch({ list_pending_claude_approvals: [CLAUDE_APPROVAL] });
    customRender(<ClaudeRunApprovalsPending />);

    const btn = await screen.findByTestId(`cli-approve-${CLAUDE_APPROVAL.run_id}`);
    await userEvent.click(btn);
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "approve_claude_run",
        expect.objectContaining({ p_run_id: CLAUDE_APPROVAL.run_id }),
      ),
    );
  });
});

describe("KanbanCard — live agent-session badge", () => {
  const STORY = {
    story_id: "00000000-0000-0000-0000-0000000000aa",
    title: "Checkout refactor",
    status: "in_progress",
    priority: "normal",
    is_starred: false,
    is_stack_default: false,
    current_agent_slug: null,
    current_run_status: null,
    default_branch: "main",
    cost_to_date: 1.23,
    tokens_to_date: 5000,
    budget_state: "ok",
    budget_consumed: 1.23,
    budget_cost_limit: null,
    last_activity_at: new Date().toISOString(),
  };

  it("renders the live phase badge + running sub-agent count when a session is attached", () => {
    customRender(
      <KanbanCard story={STORY as never} liveSession={SESSION as never} />,
      { initialEntries: ["/admin/mission-control/kanban"] },
    );
    expect(screen.getByTestId(`kanban-card-${STORY.story_id}`)).toBeInTheDocument();
    // live badge shows the phase fallback label + the running sub-agent count (1)
    expect(screen.getByText("tool use")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("hides the live badge when the session is stopped", () => {
    customRender(
      <KanbanCard story={STORY as never} liveSession={{ ...SESSION, current_phase: "stopped" } as never} />,
      { initialEntries: ["/admin/mission-control/kanban"] },
    );
    expect(screen.queryByText("tool use")).not.toBeInTheDocument();
  });
});
