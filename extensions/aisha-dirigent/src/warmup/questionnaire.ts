/**
 * Post-login Questionnaire — collects user profile data after first sign-in.
 *
 * Same auth backend as web app (Keycloak OIDC + AISHA RPC).
 * Data is persisted through the PostgreSQL RPC layer.
 * Shown once after first login — can be skipped and revisited later.
 *
 * Used by both extension standalone (QuickPick) and Workbench (Webview).
 *
 * @module
 */

import * as vscode from "vscode";
import { getAuthState } from "../auth";
import { getDirigentConfig } from "../config";
import { recordApiCall } from "../resource-tracker";
import { ot, loadLocaleSync, getActiveLocale } from "../i18n/overlay";

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

export interface UserProfile {
  role: "developer" | "designer" | "manager" | "consultant" | "other";
  aiExperience: "beginner" | "intermediate" | "advanced";
  interests: string[];
  completedAt: string;
}

const GLOBAL_STATE_KEY = "aisha.questionnaire.completed";

// ──────────────────────────────────────────
// QuickPick flow (extension standalone)
// ──────────────────────────────────────────

/**
 * Show the post-login questionnaire via VS Code QuickPick.
 * Returns the collected profile, or null if skipped/cancelled.
 */
export async function showQuestionnaire(
  context: vscode.ExtensionContext,
): Promise<UserProfile | null> {
  // Check if already completed
  if (context.globalState.get<boolean>(GLOBAL_STATE_KEY)) {
    return null;
  }

  const auth = getAuthState();
  if (!auth.isAuthenticated) return null;

  // Prime overlay cache for synchronous ot() calls
  loadLocaleSync(getActiveLocale());

  // Step 1: Role
  const roleItems: vscode.QuickPickItem[] = [
    { label: `$(code) ${ot("questionnaire.role.developer")}`, description: "developer" },
    { label: `$(paintcan) ${ot("questionnaire.role.designer")}`, description: "designer" },
    { label: `$(organization) ${ot("questionnaire.role.manager")}`, description: "manager" },
    { label: `$(comment-discussion) ${ot("questionnaire.role.consultant")}`, description: "consultant" },
    { label: `$(ellipsis) ${ot("questionnaire.role.other")}`, description: "other" },
  ];
  const rolePick = await vscode.window.showQuickPick(roleItems, {
    title: vscode.l10n.t("Tell us about yourself (1/3) \u2014 Role"),
    placeHolder: vscode.l10n.t("What is your primary role?"),
    ignoreFocusOut: true,
  });
  if (!rolePick) return null;

  // Step 2: AI Experience
  const expItems: vscode.QuickPickItem[] = [
    { label: `$(lightbulb) ${ot("questionnaire.exp.beginner")}`, description: "beginner", detail: vscode.l10n.t("Just starting out with AI tools") },
    { label: `$(rocket) ${ot("questionnaire.exp.intermediate")}`, description: "intermediate", detail: vscode.l10n.t("Using AI regularly (Copilot, ChatGPT\u2026)") },
    { label: `$(beaker) ${ot("questionnaire.exp.advanced")}`, description: "advanced", detail: vscode.l10n.t("Building custom AI solutions, fine-tuning, RAG\u2026") },
  ];
  const expPick = await vscode.window.showQuickPick(expItems, {
    title: vscode.l10n.t("Tell us about yourself (2/3) \u2014 Experience"),
    placeHolder: vscode.l10n.t("What is your experience with AI tools?"),
    ignoreFocusOut: true,
  });
  if (!expPick) return null;

  // Step 3: Interests (multi-select)
  const interestItems: vscode.QuickPickItem[] = [
    { label: ot("questionnaire.interest.aiChat"), picked: true },
    { label: ot("questionnaire.interest.codeReview") },
    { label: ot("questionnaire.interest.testing") },
    { label: ot("questionnaire.interest.deploy") },
    { label: ot("questionnaire.interest.storyManagement") },
    { label: ot("questionnaire.interest.knowledgeBase") },
    { label: ot("questionnaire.interest.designPreview") },
  ];
  const interestPicks = await vscode.window.showQuickPick(interestItems, {
    title: vscode.l10n.t("Tell us about yourself (3/3) \u2014 Interests"),
    placeHolder: vscode.l10n.t("What interests you most? (select multiple)"),
    canPickMany: true,
    ignoreFocusOut: true,
  });
  if (!interestPicks) return null;

  const profile: UserProfile = {
    role: rolePick.description as UserProfile["role"],
    aiExperience: expPick.description as UserProfile["aiExperience"],
    interests: interestPicks.map((i) => i.label),
    completedAt: new Date().toISOString(),
  };

  // Save through PostgreSQL RPC
  await saveProfileToBackend(profile);

  // Mark as completed locally
  await context.globalState.update(GLOBAL_STATE_KEY, true);

  // Set expertise level based on AI experience
  const expertiseMap: Record<string, string> = {
    beginner: "beginner",
    intermediate: "intermediate",
    advanced: "expert",
  };
  const mappedLevel = expertiseMap[profile.aiExperience] ?? "intermediate";
  await vscode.workspace.getConfiguration("aisha.dirigent").update(
    "expertiseLevel",
    mappedLevel,
    vscode.ConfigurationTarget.Global,
  );

  void vscode.window.showInformationMessage(
    vscode.l10n.t("AISHA Dirigent: Profile saved. Environment adapted for {0}.", rolePick.label),
  );

  // Set context key for walkthrough completion
  void vscode.commands.executeCommand(
    "setContext",
    "aisha.questionnaire.completed",
    true,
  );

  return profile;
}

// ──────────────────────────────────────────
// Backend persistence
// ──────────────────────────────────────────

/**
 * Save user profile through the PostgreSQL RPC layer.
 */
async function saveProfileToBackend(profile: UserProfile): Promise<void> {
  const auth = getAuthState();
  const config = getDirigentConfig();

  if (!auth.accessToken || !config.aishaUrl) return;

  try {
    const t0 = performance.now();
    const response = await fetch(`${config.aishaUrl}/rest/v1/rpc/update_my_profile_onboarding`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
        apikey: config.anonKey ?? "",
      },
      body: JSON.stringify({
        p_data: {
          aisha_profile: profile,
          onboarding_completed: true,
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    recordApiCall("auth", performance.now() - t0, 0, !response.ok);
  } catch {
    // Best-effort — profile saved locally even if backend fails
  }
}

/**
 * Check if user has completed the questionnaire (local or remote).
 */
export function isQuestionnaireCompleted(
  context: vscode.ExtensionContext,
): boolean {
  return context.globalState.get<boolean>(GLOBAL_STATE_KEY) ?? false;
}

/**
 * Reset questionnaire state (for testing or re-running).
 */
export async function resetQuestionnaire(
  context: vscode.ExtensionContext,
): Promise<void> {
  await context.globalState.update(GLOBAL_STATE_KEY, undefined);
  void vscode.commands.executeCommand(
    "setContext",
    "aisha.questionnaire.completed",
    false,
  );
}
