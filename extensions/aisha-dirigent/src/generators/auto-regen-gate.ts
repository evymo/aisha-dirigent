/**
 * Auto-regeneration gate.
 *
 * Centralized policy check for whether Dirigent may regenerate IDE instruction
 * files in response to a given event. Defaults are conservative:
 *  - Feature is **disabled** by default — only the explicit `manual` command
 *    triggers a write.
 *  - When enabled, only triggers listed in `aisha.dirigent.autoRegenerate.triggers`
 *    are allowed.
 *
 * Goal: never overwrite IDE files without an explicit user choice unless the
 * developer has opted in.
 *
 * @module
 */

import * as vscode from "vscode";

export type AutoRegenTrigger =
  | "manual"
  | "story-change"
  | "story-create"
  | "rules-updated"
  | "auto-flow";

const CONFIG_NS = "aisha.dirigent.autoRegenerate";

interface AutoRegenConfig {
  enabled: boolean;
  triggers: AutoRegenTrigger[];
}

function readConfig(): AutoRegenConfig {
  const cfg = vscode.workspace.getConfiguration(CONFIG_NS);
  const enabled = cfg.get<boolean>("enabled", false);
  const rawTriggers = cfg.get<string[]>("triggers", ["manual"]);
  const triggers: AutoRegenTrigger[] = rawTriggers
    .filter((t): t is AutoRegenTrigger =>
      ["manual", "story-change", "story-create", "rules-updated", "auto-flow"].includes(t),
    );
  return { enabled, triggers };
}

/**
 * Returns true when the caller is allowed to regenerate IDE files in response
 * to the given event trigger. `manual` always passes — it is the user's
 * explicit action and represents intent.
 */
export function shouldAutoRegenerate(trigger: AutoRegenTrigger): boolean {
  if (trigger === "manual") return true;
  const { enabled, triggers } = readConfig();
  if (!enabled) return false;
  return triggers.includes(trigger);
}

/**
 * One-time notice shown the first time an automatic regeneration is suppressed
 * due to the conservative default. Educates the user about the opt-in.
 */
const NOTICE_KEY = "aisha.dirigent.autoRegenSuppressedNoticeShown";

export async function maybeShowSuppressedNotice(
  context: vscode.ExtensionContext,
  trigger: AutoRegenTrigger,
): Promise<void> {
  if (trigger === "manual") return;
  const shown = context.globalState.get<boolean>(NOTICE_KEY, false);
  if (shown) return;

  const openSettings = vscode.l10n.t("Open Settings");
  const dismiss = vscode.l10n.t("Don't show again");
  const choice = await vscode.window.showInformationMessage(
    vscode.l10n.t(
      "AISHA Dirigent skipped auto-regenerating IDE files ({0}). Enable in settings if desired.",
      trigger,
    ),
    openSettings,
    dismiss,
  );
  if (choice === openSettings) {
    void vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "aisha.dirigent.autoRegenerate",
    );
  }
  if (choice === dismiss || choice === openSettings) {
    await context.globalState.update(NOTICE_KEY, true);
  }
}
