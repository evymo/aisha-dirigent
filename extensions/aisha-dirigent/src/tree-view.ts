/**
 * Tree view providers for the AISHA Dirigent sidebar.
 *
 * - **Session tree:** shows active moderation session info
 * - **Decisions tree:** shows decisions made in the current session
 * - **Models tree:** shows AI model registry status across providers
 *
 * @module
 */

import * as vscode from "vscode";
import { getActiveSessionId, onSessionChanged, onDecisionMade, type DecisionRecord } from "./participant";
import { getDirigentConfig, getConnectionLabel, onConfigChanged } from "./config";
import { getAuthState, onAuthStateChanged } from "./auth";
import { getDiscoveredModels, onModelsDiscovered, type DiscoveredModel } from "./llm-discovery";
import { getEnvironment, onEnvironmentChanged, type EnvironmentInfo } from "./compute-tier";
import { onSessionStateChanged, getWorkPhaseLabel, type AishaSession } from "./session-manager";
import {
  onStatsChanged,
  getSnapshot,
  getAggregateTotals,
  getModelUsage,
  formatTokens,
  formatCost,
  formatBytes,
  formatDuration,
  type ApiCategory,
  type ModelUsageRecord,
  ALL_CATEGORIES,
} from "./resource-tracker";

// ──────────────────────────────────────────
// Session Tree
// ──────────────────────────────────────────

/** Tree item for the session view */
class SessionItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    icon?: string,
    collapsibleState = vscode.TreeItemCollapsibleState.None,
  ) {
    super(label, collapsibleState);
    this.description = description;
    this.contextValue = "sessionItem";
    if (icon) this.iconPath = new vscode.ThemeIcon(icon);
  }
}

/** Status icon mapping for session states. */
const STATUS_ICONS: Record<string, string> = {
  idle: "circle-outline",
  working: "sync~spin",
  "waiting-approval": "bell",
  blocked: "error",
  completed: "check",
};

/** Phase icon mapping. */
const PHASE_ICONS: Record<string, string> = {
  routing: "arrow-swap",
  edge: "circuit-board",
  backend: "cloud",
  eval: "beaker",
  streaming: "comment",
};

/**
 * Provides session info items for the "Active Session" tree view.
 * Shows granular working state: phase, model, tier.
 */
export class SessionTreeProvider
  implements vscode.TreeDataProvider<SessionItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    SessionItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      onSessionChanged.event(() => this._onDidChangeTreeData.fire()),
      onSessionStateChanged(() => this._onDidChangeTreeData.fire()),
    );
  }

  getTreeItem(element: SessionItem): vscode.TreeItem {
    return element;
  }

  getChildren(): SessionItem[] {
    const sessionId = getActiveSessionId();

    if (!sessionId) {
      return [new SessionItem(vscode.l10n.t("No active session"), vscode.l10n.t("Use @aisha to start"), "circle-outline")];
    }

    const items: SessionItem[] = [
      new SessionItem(vscode.l10n.t("Session"), sessionId.slice(0, 8) + "…", "tag"),
    ];

    // Granular status
    const phaseLabel = getWorkPhaseLabel();
    const statusIcon = STATUS_ICONS[phaseLabel.split(":")[0]] ?? STATUS_ICONS["idle"] ?? "circle-outline";
    items.push(new SessionItem(vscode.l10n.t("Status"), phaseLabel, statusIcon));

    return items;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this._onDidChangeTreeData.dispose();
  }
}

// ──────────────────────────────────────────
// Decisions Tree
// ──────────────────────────────────────────

/** Represents a moderation decision in the tree */
class DecisionItem extends vscode.TreeItem {
  constructor(
    public readonly record: DecisionRecord,
  ) {
    super(record.type, vscode.TreeItemCollapsibleState.None);
    this.description = record.summary;
    const timeStr = new Date(record.timestamp).toLocaleTimeString();
    const tierStr = record.tier ? ` [${record.tier}]` : "";
    const modelStr = record.model ? ` (${record.model})` : "";
    this.tooltip = `[${record.severity}] ${record.type}: ${record.summary}\nSource: ${record.source}${tierStr}${modelStr}\nTime: ${timeStr}`;
    this.contextValue = "decisionItem";

    // Icon based on severity
    this.iconPath = new vscode.ThemeIcon(
      record.severity === "critical"
        ? "error"
        : record.severity === "warning"
          ? "warning"
          : "info",
    );
  }
}

/**
 * Provides decision items for the "Decisions" tree view.
 *
 * Stores decisions in local cache and supports story sync.
 * Shows rich metadata: source, tier, model, timestamp.
 */
export class DecisionsTreeProvider
  implements vscode.TreeDataProvider<DecisionItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    DecisionItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private decisions: DecisionItem[] = [];
  private decisionCache: DecisionRecord[] = [];
  private readonly disposable: vscode.Disposable;

  constructor() {
    const sessionSub = onSessionChanged.event(() => {
      // Clear decisions when session changes
      this.decisions = [];
      this.decisionCache = [];
      this._onDidChangeTreeData.fire();
    });
    const decisionSub = onDecisionMade.event((d) => {
      this.addDecision(d);
    });
    this.disposable = vscode.Disposable.from(sessionSub, decisionSub);

    // Load persisted decisions from previous session
    void this.loadPersistedDecisions();
  }

  getTreeItem(element: DecisionItem): vscode.TreeItem {
    return element;
  }

  getChildren(): DecisionItem[] {
    if (this.decisions.length === 0) {
      return [];
    }
    return this.decisions;
  }

  /**
   * Add a decision to the tree and local cache.
   */
  addDecision(record: DecisionRecord): void {
    this.decisionCache.push(record);
    this.decisions.push(new DecisionItem(record));
    this._onDidChangeTreeData.fire();
    // Persist cache to workspace storage
    void this.persistCache();
  }

  /**
   * Get all cached decisions (for story sync).
   */
  getDecisions(): DecisionRecord[] {
    return [...this.decisionCache];
  }

  /**
   * Clear all decisions.
   */
  clear(): void {
    this.decisions = [];
    this.decisionCache = [];
    this._onDidChangeTreeData.fire();
  }

  /**
   * Load persisted decisions from `.aisha/decisions.json` (previous session).
   */
  private async loadPersistedDecisions(): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0];
    if (!root) return;
    try {
      const file = vscode.Uri.joinPath(root.uri, ".aisha", "decisions.json");
      const content = await vscode.workspace.fs.readFile(file);
      const records = JSON.parse(new TextDecoder().decode(content)) as DecisionRecord[];
      if (Array.isArray(records) && records.length > 0) {
        for (const record of records) {
          this.decisionCache.push(record);
          this.decisions.push(new DecisionItem(record));
        }
        this._onDidChangeTreeData.fire();
      }
    } catch {
      // File doesn't exist or is invalid — no persisted decisions
    }
  }

  /**
   * Persist decisions to workspace .aisha/decisions.json for story sync.
   */
  private async persistCache(): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0];
    if (!root || this.decisionCache.length === 0) return;
    try {
      const dir = vscode.Uri.joinPath(root.uri, ".aisha");
      try { await vscode.workspace.fs.createDirectory(dir); } catch { /* exists */ }
      const file = vscode.Uri.joinPath(dir, "decisions.json");
      const content = JSON.stringify(this.decisionCache, null, 2);
      await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(content));
    } catch { /* non-critical */ }
  }

  dispose(): void {
    this.disposable.dispose();
    this._onDidChangeTreeData.dispose();
  }
}

// ──────────────────────────────────────────
// Models Tree — AI Model Registry
// ──────────────────────────────────────────

/** Model item in the tree */
class ModelItem extends vscode.TreeItem {
  constructor(
    public readonly provider: string,
    public readonly modelId: string,
    public readonly evalStatus: string,
    public readonly isAvailable: boolean,
    public readonly score: number | null,
    collapsibleState = vscode.TreeItemCollapsibleState.None,
  ) {
    super(modelId, collapsibleState);
    this.description = `${evalStatus}${score !== null ? ` (${score.toFixed(3)})` : ""}`;
    this.contextValue = "modelItem";
    this.tooltip = `Provider: ${provider}\nModel: ${modelId}\nStatus: ${evalStatus}\nAvailable: ${isAvailable}\nScore: ${score ?? "N/A"}`;

    // Icon based on eval status
    this.iconPath = new vscode.ThemeIcon(
      evalStatus === "approved"
        ? "check"
        : evalStatus === "rejected"
          ? "close"
          : evalStatus === "tested"
            ? "beaker"
            : "circle-outline",
      isAvailable ? undefined : new vscode.ThemeColor("disabledForeground"),
    );
  }
}

/** Provider group item */
class ProviderGroupItem extends vscode.TreeItem {
  constructor(
    public readonly provider: string,
    public readonly modelCount: number,
  ) {
    super(provider, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${modelCount} models`;
    this.contextValue = "providerGroup";
    this.iconPath = new vscode.ThemeIcon("server");
  }
}

/** Section header for models tree. */
class SectionHeaderItem extends vscode.TreeItem {
  constructor(
    public readonly section: "backend" | "edge" | "usage",
    label: string,
    childCount: number,
  ) {
    super(label, childCount > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    this.description = `${childCount}`;
    this.contextValue = `section.${section}`;
    this.iconPath = new vscode.ThemeIcon(
      section === "backend" ? "cloud"
        : section === "edge" ? "desktop-download"
        : "graph",
    );
  }
}

/** Local model item from auto-discovery. */
class LocalModelItem extends vscode.TreeItem {
  constructor(
    public readonly model: DiscoveredModel,
  ) {
    super(model.modelId, vscode.TreeItemCollapsibleState.None);
    this.description = model.provider;
    this.contextValue = "localModelItem";
    this.tooltip = `Provider: ${model.provider}\nPreset: ${model.presetName}\nModel: ${model.modelId}`;
    this.iconPath = new vscode.ThemeIcon("circuit-board");
  }
}

/** Per-model usage item. */
class ModelUsageItem extends vscode.TreeItem {
  constructor(record: ModelUsageRecord) {
    super(record.modelId, vscode.TreeItemCollapsibleState.None);
    const totalTokens = record.promptTokens + record.completionTokens;
    const avgLatency = record.callCount > 0 ? Math.round(record.totalLatencyMs / record.callCount) : 0;
    this.description = `${record.tier} · ${record.callCount} calls · ${formatTokens(totalTokens)} tokens · avg ${avgLatency}ms`;
    this.contextValue = "modelUsageItem";
    this.tooltip = `Provider: ${record.provider}\nModel: ${record.modelId}\nTier: ${record.tier}\nCalls: ${record.callCount}\nPrompt tokens: ${record.promptTokens}\nCompletion tokens: ${record.completionTokens}\nAvg latency: ${avgLatency}ms`;
    this.iconPath = new vscode.ThemeIcon(
      record.tier === "edge" ? "circuit-board" : record.tier === "self-hosted" ? "server" : "cloud",
    );
  }
}

/** Union type for tree items */
type ModelTreeItem = ModelItem | ProviderGroupItem | SectionHeaderItem | LocalModelItem | ModelUsageItem;

/**
 * Represents an AI model entry from the backend.
 */
interface ModelEntry {
  provider: string;
  model_id: string;
  eval_status: string;
  is_available: boolean;
  latest_eval_score: number | null;
}

/**
 * Provides model registry items for the "AI Models" tree view.
 *
 * Dynamically shows sections based on detected environment:
 * - Edge Models (when edge available)
 * - Backend Models (self-hosted or cloud)
 * - Per-Model Usage (when there's usage data)
 */
export class ModelsTreeProvider
  implements vscode.TreeDataProvider<ModelTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    ModelTreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private models: ModelEntry[] = [];
  private localModels: DiscoveredModel[] = [];
  private env: EnvironmentInfo;
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.localModels = getDiscoveredModels();
    this.env = getEnvironment();
    this.disposables.push(
      onModelsDiscovered((models) => {
        this.localModels = models;
        this._onDidChangeTreeData.fire();
      }),
      onEnvironmentChanged((env) => {
        this.env = env;
        this._onDidChangeTreeData.fire();
      }),
      onStatsChanged(() => {
        // Refresh when model usage changes
        this._onDidChangeTreeData.fire();
      }),
    );
  }

  getTreeItem(element: ModelTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ModelTreeItem): ModelTreeItem[] {
    if (!element) {
      // Root level — dynamic sections based on environment
      const items: ModelTreeItem[] = [];
      const usage = getModelUsage();

      // Backend section — always shown
      const backendLabel = this.env.backend.type === "self-hosted"
        ? `Self-Hosted Models (${this.env.backend.label})`
        : this.env.backend.type === "cloud"
          ? `Cloud Models (${this.env.backend.label})`
          : "Backend Models";
      items.push(new SectionHeaderItem("backend", backendLabel, this.models.length));

      // Edge section — shown when edge is available OR there are local models
      if (this.env.edge.available || this.localModels.length > 0) {
        items.push(new SectionHeaderItem("edge", "Edge Models", this.localModels.length));
      }

      // Usage section — shown when there's per-model usage data
      if (usage.length > 0) {
        items.push(new SectionHeaderItem("usage", "Model Usage", usage.length));
      }

      return items;
    }

    if (element instanceof SectionHeaderItem && element.section === "backend") {
      const providers = new Map<string, ModelEntry[]>();
      for (const m of this.models) {
        const list = providers.get(m.provider) ?? [];
        list.push(m);
        providers.set(m.provider, list);
      }
      if (providers.size === 0) {
        return [new ProviderGroupItem(vscode.l10n.t("No models loaded"), 0)];
      }
      return [...providers.entries()].map(
        ([provider, models]) => new ProviderGroupItem(provider, models.length),
      );
    }

    if (element instanceof SectionHeaderItem && element.section === "edge") {
      if (this.localModels.length === 0) {
        const emptyItem = new vscode.TreeItem(
          this.env.edge.available
            ? vscode.l10n.t("No models loaded in runtime")
            : vscode.l10n.t("No local runtime detected"),
        ) as ModelTreeItem;
        return [emptyItem];
      }
      return this.localModels.map((m) => new LocalModelItem(m));
    }

    if (element instanceof SectionHeaderItem && element.section === "usage") {
      const usage = getModelUsage();
      if (usage.length === 0) return [];
      // Sort by call count descending
      return [...usage]
        .sort((a, b) => b.callCount - a.callCount)
        .map((r) => new ModelUsageItem(r));
    }

    if (element instanceof ProviderGroupItem) {
      return this.models
        .filter((m) => m.provider === element.provider)
        .map(
          (m) =>
            new ModelItem(
              m.provider,
              m.model_id,
              m.eval_status,
              m.is_available,
              m.latest_eval_score,
            ),
        );
    }

    return [];
  }

  /**
   * Update the model list and refresh the tree.
   */
  updateModels(models: ModelEntry[]): void {
    this.models = models;
    this._onDidChangeTreeData.fire();
  }

  /**
   * Trigger a refresh of the tree view.
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

// ──────────────────────────────────────────
// Settings & Account Tree
// ──────────────────────────────────────────

/** Action item in the settings tree — clickable with a command. */
class SettingsItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    command?: vscode.Command,
    icon?: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.contextValue = "settingsItem";
    if (command) this.command = command;
    if (icon) this.iconPath = new vscode.ThemeIcon(icon);
  }
}

/**
 * Provides account & settings items for the sidebar.
 * Shows auth status, backend, guidance profile, story — all clickable.
 */
export class SettingsTreeProvider
  implements vscode.TreeDataProvider<SettingsItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    SettingsItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      onConfigChanged(() => this._onDidChangeTreeData.fire()),
      onAuthStateChanged(() => this._onDidChangeTreeData.fire()),
    );
  }

  getTreeItem(element: SettingsItem): vscode.TreeItem {
    return element;
  }

  getChildren(): SettingsItem[] {
    const config = getDirigentConfig();
    const auth = getAuthState();
    const items: SettingsItem[] = [];

    // Auth status
    if (auth.isAuthenticated) {
      items.push(
        new SettingsItem(
          vscode.l10n.t("Logged in"),
          auth.email ?? "unknown",
          { command: "aisha.dirigent.logout", title: vscode.l10n.t("Log out") },
          "verified-filled",
        ),
      );
    } else {
      items.push(
        new SettingsItem(
          vscode.l10n.t("Not logged in"),
          vscode.l10n.t("Click to log in"),
          { command: "aisha.dirigent.login", title: vscode.l10n.t("Log in") },
          "debug-disconnect",
        ),
      );
    }

    // Backend / profile
    const connectionLabel = getConnectionLabel();
    items.push(
      new SettingsItem(
        vscode.l10n.t("Backend"),
        `${connectionLabel} [${config.activeProfile || "default"}]`,
        { command: "aisha.dirigent.switchBackend", title: vscode.l10n.t("Switch backend") },
        connectionLabel === "Local Dev" ? "server" : connectionLabel === "AISHA Cloud" ? "cloud" : "globe",
      ),
    );

    // Guidance profile
    const levelLabels: Record<string, string> = {
      beginner: vscode.l10n.t("Educating"),
      intermediate: vscode.l10n.t("Collaborative"),
      advanced: vscode.l10n.t("Autonomous"),
      expert: vscode.l10n.t("Supervisory"),
    };
    const level = config.expertiseLevel || "intermediate";
    items.push(
      new SettingsItem(
        vscode.l10n.t("Guidance"),
        levelLabels[level] ?? level,
        { command: "aisha.dirigent.setExpertise", title: vscode.l10n.t("Change guidance profile") },
        level === "expert" ? "star-full" : level === "advanced" ? "rocket" : level === "beginner" ? "mortar-board" : "tools",
      ),
    );

    // Story
    const storyId = config.storyId;
    items.push(
      new SettingsItem(
        vscode.l10n.t("Story"),
        storyId ? storyId.slice(0, 8) + "…" : vscode.l10n.t("Not set"),
        { command: "aisha.dirigent.setStory", title: vscode.l10n.t("Set story") },
        storyId ? "book" : "circle-outline",
      ),
    );

    // Connect wizard
    items.push(
      new SettingsItem(
        vscode.l10n.t("Connection wizard"),
        "",
        { command: "aisha.dirigent.connect", title: vscode.l10n.t("Connect Wizard") },
        "gear",
      ),
    );

    return items;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this._onDidChangeTreeData.dispose();
  }
}

// ──────────────────────────────────────────
// Resources Tree — API & Token Usage
// ──────────────────────────────────────────

const CATEGORY_LABELS: Record<ApiCategory, string> = {
  rpc: "Backend RPC",
  mcp: "MCP Tools",
  n8n: "n8n Agents",
  auth: "Auth",
  push: "Push Channel",
  "llm-discovery": "LLM Discovery",
  "context-sync": "Context Sync",
};

const CATEGORY_ICONS: Record<ApiCategory, string> = {
  rpc: "database",
  mcp: "tools",
  n8n: "circuit-board",
  auth: "shield",
  push: "radio-tower",
  "llm-discovery": "search",
  "context-sync": "sync",
};

/** Simple tree item for the resource tree. */
class ResourceItem extends vscode.TreeItem {
  readonly category?: ApiCategory;
  readonly itemType?: "tokens" | "api" | "category" | "model-usage" | "info";

  constructor(
    label: string,
    description: string,
    icon?: string,
    collapsibleState = vscode.TreeItemCollapsibleState.None,
    options?: { category?: ApiCategory; itemType?: ResourceItem["itemType"]; tooltip?: string },
  ) {
    super(label, collapsibleState);
    this.description = description;
    this.contextValue = "resourceItem";
    if (icon) this.iconPath = new vscode.ThemeIcon(icon);
    this.category = options?.category;
    this.itemType = options?.itemType;
    if (options?.tooltip) this.tooltip = options.tooltip;
  }
}

/**
 * Provides resource usage items for the sidebar "Resources" tree view.
 */
export class ResourceTreeProvider
  implements vscode.TreeDataProvider<ResourceItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    ResourceItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly disposable: vscode.Disposable;

  constructor() {
    // Debounce tree refresh — update at most every 5s
    this.disposable = onStatsChanged(() => {
      if (this.refreshTimer) return;
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        this._onDidChangeTreeData.fire();
      }, 5_000);
    });
  }

  getTreeItem(element: ResourceItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ResourceItem): ResourceItem[] {
    if (element) {
      // Expandable children
      if (element.itemType === "tokens") {
        const snap = getSnapshot();
        const items: ResourceItem[] = [
          new ResourceItem("Prompt", formatTokens(snap.tokens.prompt), "arrow-up"),
          new ResourceItem("Completion", formatTokens(snap.tokens.completion), "arrow-down"),
        ];
        const modelUsage = getModelUsage();
        for (const m of modelUsage) {
          const total = m.promptTokens + m.completionTokens;
          items.push(
            new ResourceItem(
              `${m.provider}/${m.modelId}`,
              `${m.callCount}× ${formatTokens(total)}`,
              m.tier === "cloud" ? "cloud" : "server",
              vscode.TreeItemCollapsibleState.None,
              { itemType: "model-usage", tooltip: `Provider: ${m.provider}\nModel: ${m.modelId}\nTier: ${m.tier}\nCalls: ${m.callCount}\nPrompt tokens: ${m.promptTokens}\nCompletion tokens: ${m.completionTokens}\nAvg latency: ${Math.round(m.totalLatencyMs / m.callCount)}ms` },
            ),
          );
        }
        return items;
      }
      if (element.itemType === "category" && element.category) {
        const snap = getSnapshot();
        const s = snap.api[element.category];
        return [
          new ResourceItem("Calls", String(s.calls), "symbol-number"),
          new ResourceItem("Errors", String(s.errors), s.errors > 0 ? "error" : "check"),
          new ResourceItem("Total latency", `${Math.round(s.totalLatencyMs)}ms`, "watch"),
          new ResourceItem("Avg latency", `${s.calls > 0 ? Math.round(s.totalLatencyMs / s.calls) : 0}ms`, "dashboard"),
          new ResourceItem("Data transferred", formatBytes(s.totalBytes), "file-binary"),
        ];
      }
      return [];
    }

    const snap = getSnapshot();
    const agg = getAggregateTotals();
    const items: ResourceItem[] = [];

    // Token summary (expandable if there are tokens)
    const totalTokens = snap.tokens.prompt + snap.tokens.completion;
    const hasTokenDetails = totalTokens > 0 || getModelUsage().length > 0;
    items.push(
      new ResourceItem(
        "Tokens",
        `${formatTokens(totalTokens)} (~${formatCost(snap.tokens.estimatedCostUsd)})`,
        "symbol-number",
        hasTokenDetails ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
        { itemType: "tokens", tooltip: `Prompt: ${formatTokens(snap.tokens.prompt)}\nCompletion: ${formatTokens(snap.tokens.completion)}\nEstimated cost: ${formatCost(snap.tokens.estimatedCostUsd)}` },
      ),
    );

    // API call summary
    items.push(
      new ResourceItem(
        "API Calls",
        `${agg.totalCalls} (${agg.totalErrors} errors)`,
        "pulse",
        vscode.TreeItemCollapsibleState.None,
        { itemType: "api", tooltip: `Total calls: ${agg.totalCalls}\nTotal errors: ${agg.totalErrors}\nAvg latency: ${agg.avgLatencyMs}ms\nTotal data: ${formatBytes(agg.totalBytes)}` },
      ),
    );

    // Child processes
    items.push(
      new ResourceItem("Git Processes", String(snap.childProcesses), "terminal"),
    );

    // Uptime
    items.push(
      new ResourceItem("Uptime", formatDuration(snap.uptimeMs), "clock"),
    );

    // Per-category breakdown (expandable for detail)
    for (const cat of ALL_CATEGORIES) {
      const s = snap.api[cat];
      if (s.calls === 0) continue;
      const avg = Math.round(s.totalLatencyMs / s.calls);
      items.push(
        new ResourceItem(
          CATEGORY_LABELS[cat],
          `${s.calls} calls, avg ${avg}ms, ${formatBytes(s.totalBytes)}`,
          CATEGORY_ICONS[cat],
          vscode.TreeItemCollapsibleState.Collapsed,
          { category: cat, itemType: "category", tooltip: `${CATEGORY_LABELS[cat]}\nCalls: ${s.calls}\nErrors: ${s.errors}\nAvg latency: ${avg}ms\nTotal data: ${formatBytes(s.totalBytes)}` },
        ),
      );
    }

    if (items.length <= 4) {
      items.push(new ResourceItem("No API calls yet", "Use @aisha to start", "info"));
    }

    return items;
  }

  dispose(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.disposable.dispose();
    this._onDidChangeTreeData.dispose();
  }
}
