/**
 * Extension entry point for AISHA Dirigent.
 *
 * Registers the `@aisha` chat participant, commands, tree views,
 * status bar items, and auto-sync file watcher.
 *
 * @module
 */

import * as vscode from "vscode";
import { getDirigentConfig, getConnectionLabel, getAvailableProfiles, switchProfile, resolveConnectionLabel, onConfigChanged, updateLocalConfig, ensureConfigReady } from "./config";
import { handleChatRequest, clearSession } from "./participant";
import { SessionTreeProvider, DecisionsTreeProvider, ModelsTreeProvider, SettingsTreeProvider, ResourceTreeProvider } from "./tree-view";
import {
  AgentActivityTreeProvider,
  approveSpendFromTree,
  rejectSpendFromTree,
} from "./agent-activity-tree";
import { StatusBarManager } from "./status-bar";
import { persistStoryId, promptForStoryId, onStoryChanged } from "./story-context";
import { callMcpTool, extractMarkdown, extractJson } from "./mcp-client";
import { registerAutoFlow } from "./auto-flow";
import { registerCopilotWatcher } from "./copilot-watcher";
import { registerTerminalWatcher } from "./terminal-watcher";
import { registerConfigWriter, forceConfigRefresh } from "./config-writer";
import { startPushChannel, disconnectPushChannel, onPushEvent, type AishaPushEvent } from "./aisha-push";
import { startContextSync } from "./aisha-context-sync";
import { startWorkbenchDrainer } from "./workbench-drainer";
import { initSession } from "./session-manager";
import { registerLiveSessionPush } from "./live-session-push";
import { initAuth, login, loginWithAishaId, loginWithPkce, resolvePendingOAuthCallback, logout, signup, silentRefresh, getAuthState, onAuthStateChanged, fetchUserStories } from "./auth";
import { DashboardViewProvider } from "./dashboardView";
import { StoryChatViewProvider } from "./story-chat-view";
import { StoryPanelProvider } from "./story-panel-provider";
import { startDiscovery, discoverModels, getDiscoveredModels, onModelsDiscovered } from "./llm-discovery";
import { detectEnvironment } from "./compute-tier";
import { autoDetectGitHubConnection, createGitHubStatusBarItem, handleConnectRepo, refreshGitHubStatus } from "./github-app";
import { dispose as disposeResourceTracker } from "./resource-tracker";
import { registerAdminModelSwitch } from "./admin-model-switch";
import { syncInstructions, tierLabel } from "./tier-resolver";
import { shouldAutoRegenerate, maybeShowSuppressedNotice } from "./generators/auto-regen-gate";
import { detectTechStack } from "./workspace";
import { scanEnvironment } from "./warmup/environment-detector";
import { showQuestionnaire, isQuestionnaireCompleted } from "./warmup/questionnaire";
import { safeError } from "./safe-logger";
import { loadWelcomeContentFromConfig } from "./warmup/welcome-content";
import { SetupPanel } from "./setup-panel/SetupPanel";
import { DashboardPanel } from "./dashboard-panel/DashboardPanel";
import { isAishaWorkbench, isAishaMonorepo } from "./workbench-context";
import { initOverlay, getActiveLocale } from "./i18n/overlay";
import { showLanguageSelector, offerFirstRunLanguageSelection } from "./i18n/locale-selector";

/**
 * Sync all IDE instruction files using the 3-tier resolver.
 * Replaces the previous syncCopilotInstructions + triggerIdeRegeneration combo.
 *
 * Tier 1: Backend (MCP) — fully contextual rules
 * Tier 2: Local LLM — tech-stack-aware generation
 * Tier 3: Universal baseline — golden standards (with user consent)
 */
async function syncCopilotInstructions(storyId?: string): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) return;

  const techStack = await detectTechStack();

  const result = await syncInstructions(root.uri, {
    storyId,
    techStack,
  });

  if (!result) {
    // All tiers failed or user declined baseline
    return;
  }

  const { tier, source, generation } = result;
  const label = tierLabel(tier);
  const writtenCount = generation.written.length;
  const skippedCount = generation.skipped.length;

  if (writtenCount > 0) {
    void vscode.window.showInformationMessage(
      `Dirigent: ${vscode.l10n.t("{0} IDE files updated (Tier {1}: {2}), {3} unchanged.", String(writtenCount), String(tier), label, String(skippedCount))}`,
    );
  }

  if (generation.errors.length > 0) {
    const errorNames = generation.errors.map((e) => e.adapter).join(", ");
    void vscode.window.showWarningMessage(
      `Dirigent: ${vscode.l10n.t("Errors generating: {0}", errorNames)}`,
    );
  }
}

/**
 * Refresh the models tree view by fetching data from MCP backend.
 */
async function refreshModelsTree(modelsTree: ModelsTreeProvider): Promise<void> {
  const result = await callMcpTool("get_model_registry", {
    available_only: false,
  });
  if (!result) return;

  const json = extractJson(result);
  const models = json?.models as Array<{
    provider: string;
    model_id: string;
    eval_status: string;
    is_available: boolean;
    latest_eval_score: number | null;
  }> | undefined;

  if (models) {
    modelsTree.updateModels(models);
  }
}

function hasExplicitDirigentSetting(key: string): boolean {
  const inspected = vscode.workspace.getConfiguration("aisha.dirigent").inspect<unknown>(key);
  return inspected?.globalValue !== undefined ||
    inspected?.workspaceValue !== undefined ||
    inspected?.workspaceFolderValue !== undefined;
}

function hasExplicitDirigentSettings(): boolean {
  return [
    "aishaUrl",
    "mcpUrl",
    "bootstrapUrl",
    "orchestrationUrl",
    "webUrl",
    "keycloakUrl",
    "dashboardUrl",
  ].some((key) => hasExplicitDirigentSetting(key));
}

function hasExplicitDirigentEnv(): boolean {
  return [
    "AISHA_MCP_URL",
    "AISHA_N8N_TRIGGER_URL",
    "AISHA_POSTGREST_URL",
    "AISHA_POSTGREST_ANON_KEY",
    "AISHA_BOOTSTRAP_URL",
    "AISHA_WEB_URL",
    "AISHA_ORCHESTRATION_URL",
    "AISHA_KEYCLOAK_URL",
    "VITE_AISHA_POSTGREST_URL",
    "VITE_AISHA_POSTGREST_ANON_KEY",
    "VITE_AISHA_POSTGREST_PUBLISHABLE_KEY",
  ].some((key) => typeof process.env[key] === "string" && process.env[key]?.trim().length > 0);
}

/**
 * Called by VS Code when the extension is activated.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // ── i18n Overlay ──────────────────────────
  initOverlay(context);

  // ── Session Identity ──────────────────────
  let session: Awaited<ReturnType<typeof initSession>> | null = null;
  try {
    session = await initSession();
  } catch (err) {
    safeError("Dirigent", "initSession failed", err);
  }

  // ── User Auth ─────────────────────────────
  let authState: Awaited<ReturnType<typeof initAuth>> | null = null;
  try {
    authState = await initAuth(context);
    if (authState.isAuthenticated) {
      void vscode.window.showInformationMessage(
        `AISHA Dirigent: ${vscode.l10n.t("Logged in as {0}", authState.email ?? "unknown")}`,
      );
    }
  } catch (err) {
    safeError("Dirigent", "initAuth failed", err);
  }

  // Periodic token refresh (every 45 min — safety margin for 60 min JWT)
  const refreshInterval = setInterval(() => void silentRefresh(), 45 * 60_000);
  context.subscriptions.push(new vscode.Disposable(() => clearInterval(refreshInterval)));

  // Mirror local session state into agent_live_sessions (universal live
  // presence registry) — debounced, fail-silent, observational only.
  context.subscriptions.push(registerLiveSessionPush());

  // ── OAuth URI Handler (PKCE callback) ─────
  // Handles vscode://aisha.aisha-dirigent/did-authenticate?code=...&state=...
  // registered in KC aisha-app redirectUris as vscode://aisha.aisha-dirigent/did-authenticate
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri): void {
        if (uri.path === "/did-authenticate") {
          resolvePendingOAuthCallback(uri);
        }
      },
    }),
  );

  // Auto-logout when profile switch changes aishaUrl (tokens are backend-specific)
  let previousAishaUrl = getDirigentConfig().aishaUrl;
  context.subscriptions.push(
    onConfigChanged((newConfig) => {
      if (newConfig.aishaUrl !== previousAishaUrl) {
        previousAishaUrl = newConfig.aishaUrl;
        const auth = getAuthState();
        if (auth.isAuthenticated) {
          void logout().then(() => {
            void vscode.window.showInformationMessage(
              `AISHA Dirigent: ${vscode.l10n.t("Backend changed to {0}. Please log in again.", resolveConnectionLabel(newConfig.aishaUrl))}`,
            );
          });
        }
      }
    }),
  );

  // Welcome message on first activation (new session)
  const sessionFileUri = vscode.workspace.workspaceFolders?.[0]
    ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, ".aisha", "session.json")
    : undefined;
  let isFirstRun = false;
  if (sessionFileUri) {
    try {
      await vscode.workspace.fs.stat(sessionFileUri);
    } catch {
      isFirstRun = true;
    }
  }

  // First-run language selection (non-blocking)
  if (isFirstRun) {
    void offerFirstRunLanguageSelection(context);
  }

  // ── Context detection ──────────────────────────────────
  const inWorkbench = isAishaWorkbench();
  const hasFolder = !!vscode.workspace.workspaceFolders?.length;

  if (!hasFolder) {
    // ── No folder open ──
    if (inWorkbench) {
      const openFolder = vscode.l10n.t("Open Folder");
      const cloneRepo = vscode.l10n.t("Clone Repository");
      void vscode.window.showInformationMessage(
        `AISHA Workbench: ${vscode.l10n.t("Open a project folder to get started.")}`,
        openFolder,
        cloneRepo,
      ).then((choice) => {
        if (choice === openFolder) {
          void vscode.commands.executeCommand("workbench.action.files.openFolder");
        } else if (choice === cloneRepo) {
          void vscode.commands.executeCommand("git.clone");
        }
      });

      // Re-trigger setup when a folder is opened later
      context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
          if (vscode.workspace.workspaceFolders?.length) {
            void vscode.commands.executeCommand("aisha.dirigent.openSetup");
          }
        }),
      );
    }
  } else {
    // ── Has folder — detect project context ──
    const monorepo = await isAishaMonorepo();

    // Check for explicit config files (.aisha/dirigent.json or .local.json)
    const aishaFolderUri = vscode.Uri.joinPath(
      vscode.workspace.workspaceFolders![0].uri, ".aisha",
    );
    let hasExplicitConfig = false;
    try {
      await vscode.workspace.fs.stat(
        vscode.Uri.joinPath(aishaFolderUri, "dirigent.json"),
      );
      hasExplicitConfig = true;
    } catch { /* no tracked config */ }
    if (!hasExplicitConfig) {
      try {
        await vscode.workspace.fs.stat(
          vscode.Uri.joinPath(aishaFolderUri, "dirigent.local.json"),
        );
        hasExplicitConfig = true;
      } catch { /* no local config either */ }
    }

    if (!hasExplicitConfig) {
      hasExplicitConfig = hasExplicitDirigentSettings() || hasExplicitDirigentEnv();
    }

    // Check resolved config (may come from env vars, VS Code defaults, or files)
    const resolvedConfig = getDirigentConfig();
    const hasWorkingConfig = !!(resolvedConfig.aishaUrl || resolvedConfig.mcpUrl);
    const shouldShowWorkbenchSetup = inWorkbench && !monorepo && !hasExplicitConfig;

    if (shouldShowWorkbenchSetup) {
      // AISHA Workbench ships cloud defaults so the extension can bootstrap, but
      // the first visible step should still be the polished backend chooser.
      SetupPanel.show(context.extensionUri, () => {
        DashboardPanel.show(context.extensionUri, () => {
          SetupPanel.show(context.extensionUri);
        });
      });

    } else if (monorepo && hasWorkingConfig) {
      // ── AISHA Monorepo — local dev stack via env vars ──
      if (!resolvedConfig.anonKey && resolvedConfig.aishaUrl) {
        void ensureConfigReady().catch(() => { /* silent */ });
      }

      if (isFirstRun || !session?.currentTask) {
        const connectionLabel = getConnectionLabel();
        const openChat = vscode.l10n.t("Open Chat");
        void vscode.window.showInformationMessage(
          `AISHA Dirigent: ${vscode.l10n.t("Monorepo detected — local dev [{0}]. Type @aisha in Copilot Chat.", connectionLabel)}`,
          openChat,
        ).then((choice) => {
          if (choice === openChat) {
            void vscode.commands.executeCommand(
              "workbench.action.chat.open",
              { query: "@aisha /status" },
            );
          }
        });
      }

    } else if (!hasWorkingConfig) {
      // ── No usable config — SetupPanel for guided onboarding ──
      SetupPanel.show(context.extensionUri, () => {
        DashboardPanel.show(context.extensionUri, () => {
          SetupPanel.show(context.extensionUri);
        });
      });

    } else {
      // ── Working config available — bootstrap + dashboard ──
      if (!resolvedConfig.anonKey && resolvedConfig.aishaUrl) {
        void ensureConfigReady().catch(() => { /* silent */ });
      }

      // If authenticated and has dashboard URL → show DashboardPanel
      const authReady = getAuthState();
      if (authReady.isAuthenticated) {
        const profileUrl = resolvedConfig.activeProfile &&
          resolvedConfig.profiles[resolvedConfig.activeProfile]?.dashboardUrl;
        const dashUrl = profileUrl ?? resolvedConfig.dashboardUrl;
        if (dashUrl) {
          DashboardPanel.show(context.extensionUri, () => {
            SetupPanel.show(context.extensionUri);
          });
        }
      }

      if (isFirstRun || !session?.currentTask) {
        const mcpUrl = resolvedConfig.mcpUrl;
        const connectionLabel = getConnectionLabel();
        const openChat = vscode.l10n.t("Open Chat");
        const connectWizard = vscode.l10n.t("Connect Wizard");
        const openSettings = vscode.l10n.t("Open Settings");
        if (mcpUrl) {
          void vscode.window.showInformationMessage(
            `AISHA Dirigent: ${vscode.l10n.t("AISHA Dirigent active [{0}]. Type @aisha in Copilot Chat or use /status to check connectivity.", connectionLabel)}`,
            openChat,
          ).then((choice) => {
            if (choice === openChat) {
              void vscode.commands.executeCommand(
                "workbench.action.chat.open",
                { query: "@aisha /status" },
              );
            }
          });
        } else {
          void vscode.window.showWarningMessage(
            `AISHA Dirigent: ${vscode.l10n.t("MCP URL not configured. Use Connect Wizard or .aisha/dirigent.local.json.")}`,
            connectWizard,
            openSettings,
          ).then((choice) => {
            if (choice === connectWizard) {
              void vscode.commands.executeCommand("aisha.dirigent.connect");
            } else if (choice === openSettings) {
              void vscode.commands.executeCommand(
                "workbench.action.openSettings",
                "aisha.dirigent.mcpUrl",
              );
            }
          });
        }
      }
    }
  }

  // ── Missing copilot-instructions.md → offer wizard ──
  const wsRoot = vscode.workspace.workspaceFolders?.[0];
  if (wsRoot) {
    const instructionsUri = vscode.Uri.joinPath(wsRoot.uri, ".github", "copilot-instructions.md");
    try {
      await vscode.workspace.fs.stat(instructionsUri);
    } catch {
      // File doesn't exist — offer to generate
      const mcpUrl = getDirigentConfig().mcpUrl;
      const connectWizardBtn = vscode.l10n.t("Connect Wizard");
      if (mcpUrl) {
        const generate = vscode.l10n.t("Generate");
        const later = vscode.l10n.t("Later");
        void vscode.window.showInformationMessage(
          `AISHA Dirigent: ${vscode.l10n.t("copilot-instructions.md is missing. Generate from Knowledge Base?")}`,
          generate,
          connectWizardBtn,
          later,
        ).then((choice) => {
          if (choice === generate) {
            void vscode.commands.executeCommand("aisha.dirigent.syncInstructions");
          } else if (choice === connectWizardBtn) {
            void vscode.commands.executeCommand("aisha.dirigent.connect");
          }
        });
      } else {
        void vscode.window.showWarningMessage(
          `AISHA Dirigent: ${vscode.l10n.t("copilot-instructions.md is missing and MCP is not configured. Run Connect Wizard to set up.")}`,
          connectWizardBtn,
        ).then((choice) => {
          if (choice === connectWizardBtn) {
            void vscode.commands.executeCommand("aisha.dirigent.connect");
          }
        });
      }
    }
  }

  // ── Chat Participant ──────────────────────
  const participant = vscode.chat.createChatParticipant(
    "aisha.dirigent",
    handleChatRequest,
  );
  participant.iconPath = vscode.Uri.joinPath(
    context.extensionUri,
    "resources",
    "icon.svg",
  );

  // Follow-up provider — AISHA suggests next actions after every response
  participant.followupProvider = {
    provideFollowups(
      result: vscode.ChatResult,
      _context: vscode.ChatContext,
      _token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.ChatFollowup[]> {
      const meta = result.metadata as { followUps?: vscode.ChatFollowup[] } | undefined;
      return meta?.followUps ?? [];
    },
  };

  context.subscriptions.push(participant);

  // ── Auto-Flow (event-driven automation) ───
  registerAutoFlow(context);

  // ── Copilot Watcher (real-time compliance) ─
  registerCopilotWatcher(context);

  // ── Terminal Watcher (test/build error monitoring) ─
  registerTerminalWatcher(context);

  // ── Config Writer (dynamic agent config management) ─
  registerConfigWriter(context);

  // ── Tree Views ────────────────────────────
  const sessionTree = new SessionTreeProvider();
  const decisionsTree = new DecisionsTreeProvider();
  const modelsTree = new ModelsTreeProvider();
  const settingsTree = new SettingsTreeProvider();
  const resourceTree = new ResourceTreeProvider();
  const agentActivityTree = new AgentActivityTreeProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "aisha.dirigent.session",
      sessionTree,
    ),
    vscode.window.registerTreeDataProvider(
      "aisha.dirigent.decisions",
      decisionsTree,
    ),
    vscode.window.registerTreeDataProvider(
      "aisha.dirigent.models",
      modelsTree,
    ),
    vscode.window.registerTreeDataProvider(
      "aisha.dirigent.settings",
      settingsTree,
    ),
    vscode.window.registerTreeDataProvider(
      "aisha.dirigent.resources",
      resourceTree,
    ),
    vscode.window.registerTreeDataProvider(
      "aisha.dirigent.agentActivity",
      agentActivityTree,
    ),
    vscode.commands.registerCommand("aisha.dirigent.refreshAgentActivity", () =>
      agentActivityTree.refresh(),
    ),
    vscode.commands.registerCommand("aisha.dirigent.approveSpend", (node) =>
      approveSpendFromTree(node, agentActivityTree),
    ),
    vscode.commands.registerCommand("aisha.dirigent.rejectSpend", (node) =>
      rejectSpendFromTree(node, agentActivityTree),
    ),
    sessionTree,
    decisionsTree,
    modelsTree,
    settingsTree,
    resourceTree,
    agentActivityTree,
    new vscode.Disposable(disposeResourceTracker),
  );

  // ── Dashboard View (StoryLoop embed) ──────
  const dashboardProvider = new DashboardViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DashboardViewProvider.viewType,
      dashboardProvider,
    ),
    vscode.commands.registerCommand("aisha.dirigent.openDashboard", () => {
      DashboardPanel.show(context.extensionUri, () => {
        SetupPanel.show(context.extensionUri);
      });
    }),
    // Admin-only runtime AI model override (RPC list_ai_models_admin + set_active_ai_model_admin)
    ...((): vscode.Disposable[] => {
      registerAdminModelSwitch(context);
      return [];
    })(),
    vscode.commands.registerCommand("aisha.dirigent.openSetup", () => {
      SetupPanel.show(context.extensionUri, () => {
        DashboardPanel.show(context.extensionUri, () => {
          SetupPanel.show(context.extensionUri);
        });
      });
    }),
  );

  // ── Story Chat (secondary sidebar) ────────
  const storyChatProvider = new StoryChatViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      StoryChatViewProvider.viewType,
      storyChatProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.commands.registerCommand("aisha.dirigent.openStoryChat", () => {
      void vscode.commands.executeCommand("workbench.action.focusAuxiliaryBar");
    }),
    // Propagate story changes to chat view
    onStoryChanged((storyId) => {
      storyChatProvider.handleStoryChanged(storyId);
    }),
  );

  // ── Story Panel (story feed in secondary sidebar) ──
  const storyPanelProvider = new StoryPanelProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      StoryPanelProvider.viewType,
      storyPanelProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.commands.registerCommand("aisha.dirigent.openStoryPanel", () => {
      void vscode.commands.executeCommand("aisha.dirigent.storyPanel.focus");
    }),
  );

  // ── LLM Auto-Discovery ───────────────────
  startDiscovery(context);

  // ── Environment Detection ─────────────────
  // Run initial detection (uses discovered models + config)
  detectEnvironment();
  // Re-detect when models change or config changes
  context.subscriptions.push(
    onConfigChanged(() => detectEnvironment()),
    onModelsDiscovered(() => detectEnvironment()),
  );

  // ── Auto-fetch backend models after activation (3s delay for MCP readiness) ──
  setTimeout(() => void refreshModelsTree(modelsTree).catch(() => { /* best effort */ }), 3_000);

  // ── Aisha Push Channel ────────────────────
  startPushChannel(context);

  // Handle push events — update models tree, show notifications
  context.subscriptions.push(
    onPushEvent((event: AishaPushEvent) => {
      // Forward relevant events to Story Chat webview
      storyChatProvider.handlePushEvent(event);
      // Forward to Story Panel
      storyPanelProvider.handlePushEvent(event);

      switch (event.type) {
        case "model_discovered":
          void vscode.window.showInformationMessage(
            `Aisha: ${event.title}`,
          );
          // Refresh models tree
          void refreshModelsTree(modelsTree);
          break;
        case "eval_completed":
          void vscode.window.showInformationMessage(
            `Aisha: ${event.title}`,
          );
          break;
        case "proposal_created":
          void vscode.window.showInformationMessage(
            `Aisha: ${event.title}`,
          );
          break;
        case "recommendation":
          void vscode.window.showInformationMessage(
            `Aisha doporucuje: ${event.title}`,
            "Zobrazit",
          ).then((choice) => {
            if (choice === "Zobrazit" && event.body) {
              const doc = vscode.workspace.openTextDocument({
                content: `# ${event.title}\n\n${event.body}`,
                language: "markdown",
              });
              void doc.then((d) => vscode.window.showTextDocument(d, { preview: true }));
            }
          });
          break;
        case "rules_updated":
          if (shouldAutoRegenerate("rules-updated")) {
            void vscode.window.showInformationMessage(
              `Aisha: ${event.title} — syncing IDE instructions...`,
            );
            void syncCopilotInstructions();
          } else {
            void maybeShowSuppressedNotice(context, "rules-updated");
          }
          void forceConfigRefresh("story-change");
          break;
        case "info":
          void vscode.window.showInformationMessage(
            `Aisha: ${event.title}`,
          );
          break;
        case "story_share":
          void vscode.window.showInformationMessage(
            `Aisha: ${event.title}`,
            "Přepnout na story",
          ).then((choice) => {
            if (choice === "Přepnout na story" && event.metadata?.story_id) {
              void persistStoryId(event.metadata.story_id as string);
            }
          });
          // Refresh story list in panel
          void storyPanelProvider.refreshStories();
          break;
        case "alert":
          void vscode.window.showWarningMessage(
            `Aisha: ${event.title}`,
          );
          break;
        default:
          break;
      }
    }),
  );

  // ── Context Sync ──────────────────────────
  startContextSync(context);

  // ── Workbench Drainer ─────────────────────
  // Drains the PR-J workbench execution queue: claim → run on the local model →
  // complete. Fail-closed / opt-in (aisha.dirigent.workbenchDrainer); does nothing
  // until the developer enables it AND a local model is discovered.
  startWorkbenchDrainer(context);

  // ── Cleanup push on deactivate ────────────
  context.subscriptions.push(
    new vscode.Disposable(() => disconnectPushChannel()),
  );

  // ── Status Bar ────────────────────────────
  const statusBar = new StatusBarManager();
  context.subscriptions.push(statusBar);

  // ── Commands ──────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "aisha.dirigent.setStory",
      async () => {
        const auth = getAuthState();
        const config = getDirigentConfig();
        const aishaUrl = config.aishaUrl;

        // If logged in, offer stories from backend
        if (auth.isAuthenticated && auth.accessToken && aishaUrl) {
          try {
            const stories = await fetchUserStories(
              aishaUrl,
              auth.accessToken,
              config.anonKey ?? "",
            );
            if (stories.length) {
              const items = [
                ...stories.map((s) => ({
                  label: s.is_shared ? `$(people) ${s.title}` : s.title,
                  description: s.is_shared
                    ? `${s.status} — ${s.participation_role ?? "participant"}`
                    : s.status,
                  detail: s.id,
                })),
                { label: "$(edit) Zadat UUID ručně…", description: "", detail: "__manual__" },
              ];
              const pick = await vscode.window.showQuickPick(items, {
                title: "Vyber story/projekt",
                placeHolder: "Na kterém projektu pracuješ?",
              });
              if (!pick) return;
              if (pick.detail !== "__manual__") {
                await persistStoryId(pick.detail);
                void vscode.window.showInformationMessage(`Story: ${pick.label}`);
                return;
              }
              // Fall through to manual input
            }
          } catch {
            // Fall through to manual input
          }
        }

        // Manual fallback
        const storyId = await promptForStoryId();
        if (storyId) {
          await persistStoryId(storyId);
          void vscode.window.showInformationMessage(
            `AISHA Dirigent: ${vscode.l10n.t("Story set: {0}", storyId.slice(0, 8) + "…")}`,
          );
        }
      },
    ),

    vscode.commands.registerCommand("aisha.dirigent.clearSession", () => {
      clearSession();
      decisionsTree.clear();
      void vscode.window.showInformationMessage(
        `AISHA Dirigent: ${vscode.l10n.t("Session cleared.")}`,
      );
    }),

    vscode.commands.registerCommand(
      "aisha.dirigent.setExpertise",
      async () => {
        const currentLevel = getDirigentConfig().expertiseLevel || "intermediate";
        const pick = await vscode.window.showQuickPick(
          [
            { label: "beginner", description: vscode.l10n.t("Educating — senior guidance, decision framing, context support") },
            { label: "intermediate", description: vscode.l10n.t("Collaborative — balanced recommendations (default)") },
            { label: "advanced", description: vscode.l10n.t("Autonomous — concise, pattern-focused") },
            { label: "expert", description: vscode.l10n.t("Supervisory — minimal, exceptions only") },
          ].map((item) => ({
            ...item,
            description: item.label === currentLevel
              ? `${item.description} ✓`
              : item.description,
          })),
          { placeHolder: vscode.l10n.t("Select your guidance profile") },
        );
        if (pick) {
          const ok = await updateLocalConfig("expertiseLevel", pick.label);
          if (ok) {
            void vscode.window.showInformationMessage(
              `AISHA Dirigent: ${vscode.l10n.t("Guidance profile set to {0}", pick.label)}`,
            );
          } else {
            void vscode.window.showWarningMessage(
              `AISHA Dirigent: ${vscode.l10n.t("Cannot save — open a workspace folder.")}`,
            );
          }
        }
      },
    ),

    // Sync copilot-instructions.md command
    vscode.commands.registerCommand(
      "aisha.dirigent.syncInstructions",
      async () => {
        const storyFile = vscode.workspace.workspaceFolders?.[0];
        let storyId: string | undefined;
        if (storyFile) {
          try {
            const storyUri = vscode.Uri.joinPath(storyFile.uri, ".aisha", "story.json");
            const raw = await vscode.workspace.fs.readFile(storyUri);
            const parsed = JSON.parse(new TextDecoder().decode(raw));
            storyId = typeof parsed.story_id === "string" ? parsed.story_id
              : typeof parsed.storyId === "string" ? parsed.storyId
              : undefined;
          } catch {
            // no story file
          }
        }
        await syncCopilotInstructions(storyId);
      },
    ),

    // Refresh AI models tree
    vscode.commands.registerCommand(
      "aisha.dirigent.refreshModels",
      async () => {
        await refreshModelsTree(modelsTree);
        void vscode.window.showInformationMessage(
          `AISHA Dirigent: ${vscode.l10n.t("AI models refreshed.")}`,
        );
      },
    ),

    // Login (PKCE — default)
    vscode.commands.registerCommand(
      "aisha.dirigent.login",
      () => login(),
    ),

    // Login with PKCE explicitly
    vscode.commands.registerCommand(
      "aisha.dirigent.loginWithPkce",
      () => loginWithPkce(),
    ),

    // Login with AISHA ID (Keycloak device code flow)
    vscode.commands.registerCommand(
      "aisha.dirigent.loginWithAishaId",
      () => loginWithAishaId(),
    ),

    // Logout
    vscode.commands.registerCommand(
      "aisha.dirigent.logout",
      () => logout(),
    ),

    // Switch Backend (connection profile)
    vscode.commands.registerCommand(
      "aisha.dirigent.switchBackend",
      async () => {
        const profiles = getAvailableProfiles();
        const config = getDirigentConfig();

        const items: vscode.QuickPickItem[] = profiles.map((name) => {
          const profile = config.profiles[name];
          const label = resolveConnectionLabel(profile?.aishaUrl ?? "", undefined);
          const isCurrent = name === config.activeProfile;
          return {
            label: `${isCurrent ? "$(check) " : ""}${name}`,
            description: label,
            detail: profile?.aishaUrl ?? vscode.l10n.t("Not configured"),
          };
        });

        items.push({
          label: `$(edit) ${vscode.l10n.t("Enter URL manually…")}`,
          description: "",
          detail: "__manual__",
        });

        const pick = await vscode.window.showQuickPick(items, {
          title: `AISHA Dirigent: ${vscode.l10n.t("Switch Backend")}`,
          placeHolder: vscode.l10n.t("Select a connection profile"),
        });

        if (!pick) return;

        if (pick.detail === "__manual__") {
          const url = await vscode.window.showInputBox({
            prompt: vscode.l10n.t("Backend API URL"),
            placeHolder: "https://your-server",
            ignoreFocusOut: true,
          });
          if (!url) return;
          // Write to local config directly
          const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!root) return;
          const { existsSync: exists, readFileSync: readFs, writeFileSync: writeFs, mkdirSync } = await import("fs");
          const { join } = await import("path");
          const localPath = join(root, ".aisha", "dirigent.local.json");
          const dirPath = join(root, ".aisha");
          if (!exists(dirPath)) mkdirSync(dirPath, { recursive: true });
          const existing = exists(localPath) ? JSON.parse(readFs(localPath, "utf8")) : {};
          existing.aishaUrl = url;
          writeFs(localPath, JSON.stringify(existing, null, 2) + "\n", "utf8");
          void vscode.window.showInformationMessage(
            `AISHA Dirigent: ${vscode.l10n.t("Backend set to {0}", resolveConnectionLabel(url))}`,
          );
          return;
        }

        // Extract profile name (remove $(check) prefix if present)
        const profileName = pick.label.replace(/^\$\(check\)\s*/, "");
        const switched = await switchProfile(profileName);
        if (switched) {
          const newLabel = getConnectionLabel();
          void vscode.window.showInformationMessage(
            `AISHA Dirigent: ${vscode.l10n.t("Switched to {0}", newLabel)}`,
          );
        }
      },
    ),

    // Connect — redirect to SetupPanel for guided flow
    vscode.commands.registerCommand(
      "aisha.dirigent.connect",
      async () => {
        SetupPanel.show(context.extensionUri, () => {
          DashboardPanel.show(context.extensionUri, () => {
            SetupPanel.show(context.extensionUri);
          });
        });
      },
    ),

    // Signup
    vscode.commands.registerCommand(
      "aisha.dirigent.signup",
      () => signup(),
    ),

    // Select LLM Preset
    vscode.commands.registerCommand(
      "aisha.dirigent.selectLlmPreset",
      async () => {
        const config = getDirigentConfig();
        const discovered = getDiscoveredModels();

        const presetItems: vscode.QuickPickItem[] = Object.entries(config.llm.presets).map(
          ([name, preset]) => {
            const online = discovered.some((m) => m.presetName === name);
            const isCurrent = name === config.llm.activePreset;
            return {
              label: `${isCurrent ? "$(check) " : ""}${name}`,
              description: `${preset.provider} — ${preset.baseUrl}`,
              detail: online ? "$(circle-filled) Online" : "$(circle-outline) Offline",
            };
          },
        );

        const pick = await vscode.window.showQuickPick(presetItems, {
          title: "AISHA: Select LLM Preset",
          placeHolder: "Choose a local or remote LLM provider",
        });

        if (!pick) return;
        const presetName = pick.label.replace(/^\$\(check\)\s*/, "");
        // Write llm.activePreset to local config (nested object update)
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) return;
        const { existsSync, readFileSync, writeFileSync, mkdirSync } = await import("fs");
        const { join } = await import("path");
        const dirPath = join(root, ".aisha");
        if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
        const localPath = join(dirPath, "dirigent.local.json");
        const existing = existsSync(localPath) ? JSON.parse(readFileSync(localPath, "utf8")) : {};
        existing.llm = { ...(existing.llm ?? {}), activePreset: presetName };
        writeFileSync(localPath, JSON.stringify(existing, null, 2) + "\n", "utf8");
        void vscode.window.showInformationMessage(
          `AISHA: LLM preset set to ${presetName}`,
        );
      },
    ),

    // Discover LLM models manually
    vscode.commands.registerCommand(
      "aisha.dirigent.discoverModels",
      async () => {
        const models = await discoverModels();
        void vscode.window.showInformationMessage(
          `AISHA: Discovered ${models.length} local model(s)`,
        );
      },
    ),
  );

  // ── Warmup Commands ───────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "aisha.dirigent.scanEnvironment",
      async () => {
        const env = await scanEnvironment();
        const detected = env.services.filter((s) => s.detected);
        if (detected.length > 0) {
          void vscode.window.showInformationMessage(
            `AISHA: ${vscode.l10n.t("Nalezeno {0} služeb: {1}", String(detected.length), detected.map((s) => s.name).join(", "))}`,
          );
        } else {
          void vscode.window.showInformationMessage(
            vscode.l10n.t("AISHA: Žádné lokální služby nenalezeny."),
          );
        }
      },
    ),

    vscode.commands.registerCommand(
      "aisha.dirigent.showQuestionnaire",
      () => showQuestionnaire(context),
    ),

    vscode.commands.registerCommand(
      "aisha.dirigent.openWalkthrough",
      () => vscode.commands.executeCommand(
        "workbench.action.openWalkthrough",
        "aisha.aisha-dirigent#aishaWelcome",
        false,
      ),
    ),

    vscode.commands.registerCommand(
      "aisha.dirigent.selectLanguage",
      () => showLanguageSelector(context),
    ),
  );

  // ── Post-login questionnaire trigger ──────
  context.subscriptions.push(
    onAuthStateChanged((state) => {
      if (state.isAuthenticated) {
        // Set context key for walkthrough completionEvent
        void vscode.commands.executeCommand("setContext", "aisha.isAuthenticated", true);
        // Refresh story list in chat view after login
        void storyChatProvider.refreshStoryList();
        // Trigger questionnaire on first login (non-blocking)
        if (!isQuestionnaireCompleted(context)) {
          void showQuestionnaire(context);
        }
      } else {
        void vscode.commands.executeCommand("setContext", "aisha.isAuthenticated", false);
      }
    }),
  );

  // ── Initial environment scan (non-blocking, 2s delay) ──
  setTimeout(() => void scanEnvironment().catch(() => { /* best effort */ }), 2_000);

  // ── Load marketplace welcome content overrides ──
  loadWelcomeContentFromConfig();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("aisha.welcome")) {
        loadWelcomeContentFromConfig();
      }
      if (e.affectsConfiguration("aisha.dirigent.languageOverride")) {
        // Re-initialize overlay to pick up new locale choice
        initOverlay(context);
      }
    }),
  );

  // ── File Watcher: auto-sync on story.json change ─────
  const storyWatcher = vscode.workspace.createFileSystemWatcher(
    "**/.aisha/story.json",
  );
  storyWatcher.onDidChange(async (uri) => {
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      const parsed = JSON.parse(new TextDecoder().decode(raw));
      // story-context.ts persists as `story_id`, support both keys for safety
      const storyId = typeof parsed.story_id === "string" ? parsed.story_id
        : typeof parsed.storyId === "string" ? parsed.storyId
        : undefined;
      if (storyId) {
        if (shouldAutoRegenerate("story-change")) {
          await syncCopilotInstructions(storyId);
        } else {
          void maybeShowSuppressedNotice(context, "story-change");
        }
      }
    } catch {
      // ignore parse errors
    }
  });
  storyWatcher.onDidCreate(async (uri) => {
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      const parsed = JSON.parse(new TextDecoder().decode(raw));
      const storyId = typeof parsed.story_id === "string" ? parsed.story_id
        : typeof parsed.storyId === "string" ? parsed.storyId
        : undefined;
      if (storyId) {
        if (shouldAutoRegenerate("story-create")) {
          await syncCopilotInstructions(storyId);
        } else {
          void maybeShowSuppressedNotice(context, "story-create");
        }
      }
    } catch {
      // ignore
    }
  });
  context.subscriptions.push(storyWatcher);

  // ── GitHub App Integration ────────────────
  const githubStatusBar = createGitHubStatusBarItem();
  context.subscriptions.push(githubStatusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "aisha.dirigent.connectRepo",
      async () => {
        // Open chat with /connect-repo command
        void vscode.commands.executeCommand(
          "workbench.action.chat.open",
          { query: "@aisha /connect-repo" },
        );
      },
    ),
  );

  // Auto-detect GitHub App connection on activation (non-blocking)
  void autoDetectGitHubConnection(context).then(() => {
    void refreshGitHubStatus(githubStatusBar);
  });

  // Refresh GitHub status when story changes
  storyWatcher.onDidChange(() => {
    void refreshGitHubStatus(githubStatusBar);
  });
}

/**
 * Called by VS Code when the extension is deactivated.
 */
export function deactivate(): void {
  // All disposables are handled via context.subscriptions
}
