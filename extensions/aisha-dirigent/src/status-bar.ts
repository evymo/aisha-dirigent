/**
 * Status bar integration for AISHA Dirigent.
 *
 * Shows:
 * - Current guidance profile + connection backend label
 * - Active session indicator
 *
 * @module
 */

import * as vscode from "vscode";
import { getDirigentConfig, getConnectionLabel, getConnectionIcon, onConfigChanged } from "./config";
import { getActiveSessionId, onSessionChanged } from "./participant";
import { onStatsChanged, getSnapshot, formatTokens, formatCost } from "./resource-tracker";
import { onSessionStateChanged, getWorkPhaseLabel } from "./session-manager";
import { onTierStateChanged, getCurrentTierState, tierLabel } from "./tier-resolver";

import type { TierState } from "./tier-resolver";

const EXPERTISE_ICONS: Record<string, string> = {
  beginner: "$(mortar-board)",
  intermediate: "$(tools)",
  advanced: "$(rocket)",
  expert: "$(star-full)",
};

/**
 * Manages the Dirigent status bar items.
 */
export class StatusBarManager implements vscode.Disposable {
  private readonly expertiseItem: vscode.StatusBarItem;
  private readonly sessionItem: vscode.StatusBarItem;
  private readonly tokenItem: vscode.StatusBarItem;
  private readonly tierItem: vscode.StatusBarItem;
  private tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    // Guidance profile + connection indicator (left side)
    this.expertiseItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      50,
    );
    this.expertiseItem.name = "AISHA Guidance Profile";
    this.expertiseItem.command = "aisha.dirigent.switchBackend";

    // Session indicator (left side, next to expertise)
    this.sessionItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      49,
    );
    this.sessionItem.name = "AISHA Session";
    this.sessionItem.command = "aisha.dirigent.clearSession";

    // Token counter (right side)
    this.tokenItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.tokenItem.name = "AISHA Token Usage";
    this.tokenItem.command = "workbench.action.chat.open";

    // Tier indicator (left side, after session)
    this.tierItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      48,
    );
    this.tierItem.name = "AISHA Instruction Tier";
    this.tierItem.command = "aisha.dirigent.syncInstructions";

    // Listen for resource stats changes (debounced)
    this.disposables.push(
      onStatsChanged(() => {
        if (this.tokenRefreshTimer) return;
        this.tokenRefreshTimer = setTimeout(() => {
          this.tokenRefreshTimer = null;
          this.updateTokenCounter();
        }, 3_000);
      }),
    );

    // Listen for config changes (profile switch)
    this.disposables.push(
      onConfigChanged(() => {
        this.updateExpertise();
      }),
    );

    // Listen for VS Code config changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("aisha.dirigent.expertiseLevel")) {
          this.updateExpertise();
        }
      }),
    );

    // Listen for session changes
    this.disposables.push(
      onSessionChanged.event(() => {
        this.updateSession();
      }),
      onSessionStateChanged(() => {
        this.updateSession();
      }),
    );

    // Listen for tier changes
    this.disposables.push(
      onTierStateChanged((state) => {
        this.updateTier(state);
      }),
    );

    this.updateExpertise();
    this.updateSession();
    this.updateTokenCounter();
    this.updateTier(getCurrentTierState());
    this.expertiseItem.show();
  }

  private static readonly GUIDANCE_LABELS: Record<string, string> = {
    beginner: "Educating",
    intermediate: "Collaborative",
    advanced: "Autonomous",
    expert: "Supervisory",
  };

  private updateExpertise(): void {
    const config = getDirigentConfig();
    const level = config.expertiseLevel ?? "intermediate";
    const connectionLabel = getConnectionLabel();
    const connectionIcon = getConnectionIcon(connectionLabel);

    const guidanceLabel = StatusBarManager.GUIDANCE_LABELS[level] ?? level;
    this.expertiseItem.text = `${connectionIcon} Dirigent: ${guidanceLabel} [${connectionLabel}]`;
    this.expertiseItem.tooltip = vscode.l10n.t("AISHA Dirigent \u2014 guidance: {0}\nBackend: {1} ({2})\nClick to switch backend", guidanceLabel, connectionLabel, config.aishaUrl || vscode.l10n.t("not configured"));
  }

  private updateSession(): void {
    const sessionId = getActiveSessionId();
    if (sessionId) {
      const phaseLabel = getWorkPhaseLabel();
      const phaseIcon = phaseLabel === "idle" ? "$(pulse)" : "$(sync~spin)";
      this.sessionItem.text = `${phaseIcon} ${sessionId.slice(0, 8)} [${phaseLabel}]`;
      this.sessionItem.tooltip = vscode.l10n.t("Active session: {0}\nPhase: {1}\nClick to clear", sessionId, phaseLabel);
      this.sessionItem.show();
    } else {
      this.sessionItem.hide();
    }
  }

  private updateTokenCounter(): void {
    const showCounter = vscode.workspace.getConfiguration("aisha.dirigent").get<boolean>("showTokenCounter", true);
    if (!showCounter) {
      this.tokenItem.hide();
      return;
    }
    const snap = getSnapshot();
    const total = snap.tokens.prompt + snap.tokens.completion;
    if (total === 0) {
      this.tokenItem.hide();
      return;
    }
    this.tokenItem.text = `$(symbol-number) ${formatTokens(total)} (~${formatCost(snap.tokens.estimatedCostUsd)})`;
    this.tokenItem.tooltip = vscode.l10n.t(
      "AISHA tokens: {0} prompt + {1} completion\nEstimated cost: {2}\nClick to open chat",
      formatTokens(snap.tokens.prompt),
      formatTokens(snap.tokens.completion),
      formatCost(snap.tokens.estimatedCostUsd),
    );
    this.tokenItem.show();
  }

  private static readonly TIER_ICONS: Record<number, string> = {
    1: "$(cloud)",
    2: "$(server-process)",
    3: "$(shield)",
  };

  private updateTier(state: TierState): void {
    if (state.syncing) {
      this.tierItem.text = "$(sync~spin) Dirigent: syncing…";
      this.tierItem.tooltip = vscode.l10n.t("Syncing IDE instructions…");
      this.tierItem.show();
      return;
    }

    if (state.tier === null) {
      this.tierItem.hide();
      return;
    }

    const icon = StatusBarManager.TIER_ICONS[state.tier] ?? "$(info)";
    const label = tierLabel(state.tier);
    this.tierItem.text = `${icon} T${state.tier}: ${label}`;
    this.tierItem.tooltip = vscode.l10n.t(
      "IDE instructions: Tier {0} ({1})\nSource: {2}\nClick to re-sync",
      String(state.tier),
      label,
      state.source ?? "unknown",
    );
    this.tierItem.show();
  }

  dispose(): void {
    this.expertiseItem.dispose();
    this.sessionItem.dispose();
    this.tokenItem.dispose();
    this.tierItem.dispose();
    if (this.tokenRefreshTimer) clearTimeout(this.tokenRefreshTimer);
    for (const d of this.disposables) d.dispose();
  }
}
