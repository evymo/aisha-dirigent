/**
 * Locale selector — QuickPick UI for choosing / creating extension translations.
 *
 * Entry points:
 *   showLanguageSelector(context) — full picker with existing + "create custom" option
 *   offerFirstRunLanguageSelection(context) — silent auto-detect on first activation
 *   detectPreferredLocale() — reads override setting then vscode.env.language
 *
 * @module i18n/locale-selector
 */

import * as vscode from "vscode";
import {
  getActiveLocale,
  setActiveLocale,
  listAvailableLocales,
} from "./overlay";
import { generateAndSaveTranslation } from "./ai-translator";

// ─── Locale display names ─────────────────────────────────────────────────────

export const LOCALE_DISPLAY_NAMES: Record<string, string> = {
  en: "English",
  cs: "Čeština",
  de: "Deutsch",
  fr: "Français",
  ru: "Русский",
  th: "ภาษาไทย",
  sk: "Slovenčina",
  pl: "Polski",
  ja: "日本語",
  zh: "中文",
  ko: "한국어",
  es: "Español",
  pt: "Português",
  it: "Italiano",
  nl: "Nederlands",
  hu: "Magyar",
  ro: "Română",
  tr: "Türkçe",
  uk: "Українська",
};

// ─── Main picker ─────────────────────────────────────────────────────────────

/**
 * Show a QuickPick for locale selection.
 * Lists available locales with current locale highlighted,
 * plus a "Create my own translation…" option.
 */
export async function showLanguageSelector(
  context: vscode.ExtensionContext,
): Promise<void> {
  const available = listAvailableLocales();
  const current = getActiveLocale();

  const localeItems: vscode.QuickPickItem[] = available.map((loc) => ({
    label: `${loc === current ? "$(check) " : ""}${LOCALE_DISPLAY_NAMES[loc] ?? loc}`,
    description: loc,
    detail: loc === current ? vscode.l10n.t("Currently active") : undefined,
  }));

  const items: vscode.QuickPickItem[] = [
    ...localeItems,
    { label: "", kind: vscode.QuickPickItemKind.Separator },
    {
      label: `$(add) ${vscode.l10n.t("Create my own translation\u2026")}`,
      description: "__new__",
      detail: vscode.l10n.t("Generate a translation with AI assistance"),
    },
  ];

  const pick = await vscode.window.showQuickPick(items, {
    title: vscode.l10n.t("AISHA: Select Extension Language"),
    placeHolder: vscode.l10n.t("Choose a language for the AISHA extension UI"),
    matchOnDescription: true,
  });

  if (!pick) return;

  if (pick.description === "__new__") {
    await promptAndCreateTranslation(context);
    return;
  }

  const locale = pick.description ?? "";
  if (!locale || locale === current) return;

  setActiveLocale(locale);
  void vscode.window.showInformationMessage(
    vscode.l10n.t(
      "AISHA: Language set to {0}. Reopen panels to apply.",
      LOCALE_DISPLAY_NAMES[locale] ?? locale,
    ),
  );
}

// ─── Custom translation wizard ────────────────────────────────────────────────

async function promptAndCreateTranslation(
  context: vscode.ExtensionContext,
): Promise<void> {
  const localeInput = await vscode.window.showInputBox({
    title: vscode.l10n.t("Create custom translation"),
    prompt: vscode.l10n.t(
      "Enter ISO language code (e.g. 'sk', 'pl', 'ja', 'zh')",
    ),
    placeHolder: "sk",
    validateInput: (v) => {
      if (!v || !/^[a-z]{2,3}(-[A-Z]{2})?$/.test(v.trim())) {
        return vscode.l10n.t(
          "Use a 2-3 letter ISO language code, e.g. 'sk', 'pl', 'zh'",
        );
      }
      return undefined;
    },
  });

  if (!localeInput) return;

  const locale = localeInput.trim().toLowerCase().split("-")[0];
  await generateAndSaveTranslation(context, locale);
}

// ─── First-run detection ──────────────────────────────────────────────────────

/**
 * Detect the best locale for this user.
 * Reads languageOverride setting first, then vscode.env.language.
 */
export function detectPreferredLocale(): string {
  const override = vscode.workspace
    .getConfiguration("aisha.dirigent")
    .get<string>("languageOverride");
  if (override && override !== "auto") {
    return override.split("-")[0].toLowerCase();
  }
  return (vscode.env.language ?? "en").split("-")[0].toLowerCase();
}

/**
 * Offer language selection on first activation.
 * - If preferred locale is EN: silent (EN is the default).
 * - If available: auto-select + dismissible notification.
 * - If not available: offer to create a translation.
 *
 * Shown at most once (tracked in globalState).
 */
export async function offerFirstRunLanguageSelection(
  context: vscode.ExtensionContext,
): Promise<void> {
  const FIRST_RUN_KEY = "aisha.i18n.firstRunDone";
  if (context.globalState.get<boolean>(FIRST_RUN_KEY)) return;
  await context.globalState.update(FIRST_RUN_KEY, true);

  const preferred = detectPreferredLocale();
  if (preferred === "en") return; // EN is default — no prompt needed

  const available = listAvailableLocales();
  const displayName = LOCALE_DISPLAY_NAMES[preferred] ?? preferred;

  if (available.includes(preferred)) {
    // Auto-apply and inform user
    setActiveLocale(preferred);
    void vscode.window.showInformationMessage(
      vscode.l10n.t(
        "AISHA: Extension language set to {0}. You can change it anytime via AISHA: Select Language.",
        displayName,
      ),
      vscode.l10n.t("Change"),
    ).then((choice) => {
      if (choice === vscode.l10n.t("Change")) {
        void vscode.commands.executeCommand("aisha.dirigent.selectLanguage");
      }
    });
  } else {
    // Locale not bundled — offer to generate
    void vscode.window.showInformationMessage(
      vscode.l10n.t(
        "AISHA: Your locale ({0}) isn\u2019t available yet. Create a translation with AI?",
        displayName,
      ),
      vscode.l10n.t("Create translation"),
      vscode.l10n.t("Use English"),
    ).then((choice) => {
      if (choice === vscode.l10n.t("Create translation")) {
        void vscode.commands.executeCommand("aisha.dirigent.selectLanguage");
      }
    });
  }
}
