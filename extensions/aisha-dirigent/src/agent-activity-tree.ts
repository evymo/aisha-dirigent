/**
 * AgentActivityTreeProvider — the "what's running + what costs" view inside
 * the Dirigent sidebar. Two root groups:
 *
 *   Agent sessions    — list_active_agent_sessions: every live work session
 *                       across surfaces (claude-code, vscode, zed, …) with its
 *                       phase, token/cost rollup, and expandable sub-agents.
 *   Spend approvals   — list_pending_spend_approvals: runs blocked at admission
 *                       awaiting a cost decision; approve/reject via context
 *                       menu (admin/staff only — the RPCs enforce it).
 *
 * Mirrors the data the web Mission Control panes show, so a developer sees the
 * same picture in the IDE. Read path is authenticatedFetch (shared resource
 * tracker + auth refresh); refresh on a 10s timer + on demand.
 *
 * @module
 */
import * as vscode from "vscode";

import { authenticatedFetch, getBaseUrl, isApiReady } from "./authenticated-fetch";

const REFRESH_INTERVAL_MS = 10_000;

interface AgentLiveSessionRow {
  session_id: string;
  source: string;
  story_id: string | null;
  story_title: string | null;
  current_phase: string;
  phase_detail: string | null;
  last_tool: string | null;
  subagents: Array<{ label?: string | null; status?: string | null }>;
  tokens_input: number;
  tokens_output: number;
  cost_usd: number;
  elapsed_ms: number;
}

interface SpendApprovalRow {
  run_id: string;
  kind: string;
  story_title: string | null;
  estimate_usd: number | null;
  decision_reason: string | null;
  age_ms: number;
}

type Node =
  | { kind: "group"; id: "sessions" | "approvals"; label: string; count: number }
  | { kind: "session"; row: AgentLiveSessionRow }
  | { kind: "subagent"; label: string; status: string }
  | { kind: "approval"; row: SpendApprovalRow };

export class AgentActivityTreeProvider
  implements vscode.TreeDataProvider<Node>, vscode.Disposable
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private sessions: AgentLiveSessionRow[] = [];
  private approvals: SpendApprovalRow[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    this.timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
    void this.refresh();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this._onDidChangeTreeData.dispose();
  }

  async refresh(): Promise<void> {
    if (!isApiReady()) {
      this.sessions = [];
      this.approvals = [];
      this._onDidChangeTreeData.fire(undefined);
      return;
    }
    const [sessions, approvals] = await Promise.all([
      authenticatedFetch<AgentLiveSessionRow[]>(
        `${getBaseUrl()}/rest/v1/rpc/list_active_agent_sessions`,
        { body: { p_limit: 20 } },
      ),
      authenticatedFetch<SpendApprovalRow[]>(
        `${getBaseUrl()}/rest/v1/rpc/list_pending_spend_approvals`,
        { body: { p_limit: 20 } },
      ),
    ]);
    this.sessions = sessions.ok ? sessions.data : [];
    // Spend approvals are admin-only — a non-admin caller gets an auth error;
    // treat that as "no approvals to show" rather than surfacing an error.
    this.approvals = approvals.ok ? approvals.data : [];
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case "group": {
        const item = new vscode.TreeItem(
          `${node.label} (${node.count})`,
          node.count > 0
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None,
        );
        item.iconPath = new vscode.ThemeIcon(
          node.id === "sessions" ? "pulse" : "law",
        );
        item.contextValue = `aisha.agentActivity.${node.id}`;
        return item;
      }
      case "session": {
        const r = node.row;
        const cost = r.cost_usd > 0 ? ` · $${r.cost_usd.toFixed(2)}` : "";
        const item = new vscode.TreeItem(
          `${r.story_title ?? r.source} — ${r.current_phase}${cost}`,
          r.subagents.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
        );
        item.description = `${r.source} · ${formatElapsed(r.elapsed_ms)}`;
        item.tooltip = new vscode.MarkdownString(
          [
            `**${r.story_title ?? "(no story)"}** — ${r.source}`,
            `Phase: ${r.current_phase}${r.phase_detail ? ` (${r.phase_detail})` : ""}`,
            r.last_tool ? `Last tool: ${r.last_tool}` : "",
            `Tokens: ${r.tokens_input + r.tokens_output} · Cost: $${r.cost_usd.toFixed(4)}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        );
        item.iconPath = new vscode.ThemeIcon("server-process");
        return item;
      }
      case "subagent": {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.description = node.status;
        item.iconPath = new vscode.ThemeIcon(
          node.status === "running" ? "loading~spin" : "check",
        );
        return item;
      }
      case "approval": {
        const r = node.row;
        const est = r.estimate_usd != null ? ` ~$${r.estimate_usd.toFixed(2)}` : "";
        const item = new vscode.TreeItem(
          `${r.kind}${est}`,
          vscode.TreeItemCollapsibleState.None,
        );
        item.description = r.story_title ?? formatElapsed(r.age_ms);
        item.tooltip = r.decision_reason ?? undefined;
        item.iconPath = new vscode.ThemeIcon("warning");
        // contextValue enables the approve/reject context-menu commands.
        item.contextValue = "aisha.spendApproval";
        return item;
      }
    }
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      return [
        { kind: "group", id: "sessions", label: "Agent sessions", count: this.sessions.length },
        { kind: "group", id: "approvals", label: "Spend approvals", count: this.approvals.length },
      ];
    }
    if (node.kind === "group" && node.id === "sessions") {
      return this.sessions.map((row) => ({ kind: "session", row }) as Node);
    }
    if (node.kind === "group" && node.id === "approvals") {
      return this.approvals.map((row) => ({ kind: "approval", row }) as Node);
    }
    if (node.kind === "session") {
      return node.row.subagents.map(
        (s) =>
          ({
            kind: "subagent",
            label: s.label ?? "agent",
            status: s.status ?? "unknown",
          }) as Node,
      );
    }
    return [];
  }

  /** The run_id behind a spend-approval tree item, for the approve/reject cmds. */
  runIdOf(node: Node | undefined): string | undefined {
    return node?.kind === "approval" ? node.row.run_id : undefined;
  }

  estimateOf(node: Node | undefined): number | null {
    return node?.kind === "approval" ? node.row.estimate_usd : null;
  }
}

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

/** Approve a blocked spend run from the IDE (admin/staff — RPC enforces). */
export async function approveSpendFromTree(
  node: Node | undefined,
  tree: AgentActivityTreeProvider,
): Promise<void> {
  const runId = tree.runIdOf(node);
  if (!runId) return;
  const estimate = tree.estimateOf(node);
  const raise = await vscode.window.showQuickPick(["Approve", "Approve + raise budget", "Cancel"], {
    placeHolder: vscode.l10n.t("Approve this spend?"),
  });
  if (!raise || raise === "Cancel") return;
  const body: Record<string, unknown> = { p_run_id: runId };
  if (raise === "Approve + raise budget" && estimate && estimate > 0) {
    body.p_raise_budget_usd = estimate;
  }
  const res = await authenticatedFetch(
    `${getBaseUrl()}/rest/v1/rpc/approve_task_spend_audited`,
    { body },
  );
  if (res.ok) {
    void vscode.window.showInformationMessage(vscode.l10n.t("Spend approved."));
    await tree.refresh();
  } else {
    void vscode.window.showErrorMessage(vscode.l10n.t("Approve failed."));
  }
}

/** Reject a blocked spend run from the IDE. */
export async function rejectSpendFromTree(
  node: Node | undefined,
  tree: AgentActivityTreeProvider,
): Promise<void> {
  const runId = tree.runIdOf(node);
  if (!runId) return;
  const reason = await vscode.window.showInputBox({
    prompt: vscode.l10n.t("Reason for rejecting this spend (optional)"),
  });
  if (reason === undefined) return; // user cancelled
  const res = await authenticatedFetch(
    `${getBaseUrl()}/rest/v1/rpc/reject_task_spend_audited`,
    { body: { p_run_id: runId, p_reason: reason || null } },
  );
  if (res.ok) {
    void vscode.window.showInformationMessage(vscode.l10n.t("Spend rejected."));
    await tree.refresh();
  } else {
    void vscode.window.showErrorMessage(vscode.l10n.t("Reject failed."));
  }
}
