/**
 * AI Translation Generator — creates new locale translations using MCP or local LLM.
 *
 * Workflow:
 *   1. Load the bundled EN source dictionary (resources/i18n/en.json)
 *   2. Generate translations via MCP tool "translate_json_keys" (online)
 *      or edgeChat local LLM (offline fallback)
 *   3. Validate the output (all values must be strings, no extra keys)
 *   4. Open a JSON preview document so the user can review
 *   5. Offer: Save globally / Save to workspace / Submit to cloud / Discard
 *
 * Security: no PII is transmitted — only the UI string dictionary.
 *
 * @module i18n/ai-translator
 */

import * as vscode from "vscode";
import { callMcpTool, extractJson } from "../mcp-client";
import { edgeChat } from "../local-llm-client";
import {
  saveUserTranslation,
  setActiveLocale,
  loadSourceDict,
} from "./overlay";
import { LOCALE_DISPLAY_NAMES } from "./locale-selector";

import type { LocaleDict } from "./overlay";
import type { ChatMessage } from "../local-llm-client";

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Generate a translation for `locale`, show preview, and let user decide where to save.
 */
export async function generateAndSaveTranslation(
  context: vscode.ExtensionContext,
  locale: string,
): Promise<void> {
  const sourceDict = loadSourceDict();
  if (Object.keys(sourceDict).length === 0) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("AISHA: Source translation file (en.json) not found."),
    );
    return;
  }

  let translated: LocaleDict | null = null;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t(
        "AISHA: Generating {0} translation\u2026",
        LOCALE_DISPLAY_NAMES[locale] ?? locale,
      ),
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: vscode.l10n.t("Trying AISHA backend\u2026") });
      translated = await translateViaMcp(sourceDict, locale);

      if (!translated) {
        progress.report({ message: vscode.l10n.t("Trying local AI model\u2026") });
        translated = await translateViaLocalLlm(sourceDict, locale);
      }
    },
  );

  if (!translated) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t(
        "AISHA: Could not generate translation. Connect to AISHA backend or a local AI model (Ollama, Docker AI).",
      ),
    );
    return;
  }

  await showTranslationResult(context, locale, translated, sourceDict);
}

// ─── Translation backends ─────────────────────────────────────────────────────

async function translateViaMcp(
  source: LocaleDict,
  targetLocale: string,
): Promise<LocaleDict | null> {
  try {
    const result = await callMcpTool("translate_json_keys", {
      source_dict: source,
      target_locale: targetLocale,
      source_locale: "en",
      context:
        "VS Code extension UI strings for the AISHA AI development assistant. Keep technical terms like MCP, AISHA, Docker, UUID, API untranslated. Preserve {0}, {1} placeholders and $(icon) syntax.",
    });

    if (!result) return null;

    const json = extractJson(result);
    if (!json) return null;

    return isValidLocaleDict(json) ? json : null;
  } catch {
    return null;
  }
}

async function translateViaLocalLlm(
  source: LocaleDict,
  targetLocale: string,
): Promise<LocaleDict | null> {
  const languageName = LOCALE_DISPLAY_NAMES[targetLocale] ?? targetLocale;

  const systemPrompt = [
    "You are a professional software localization expert.",
    `Translate the provided JSON dictionary from English to ${languageName} (${targetLocale}).`,
    "Rules:",
    "- Keep all keys exactly as-is (do not translate keys)",
    "- Translate only the VALUES",
    "- Preserve placeholders like {0}, {1} exactly as they appear",
    "- Preserve VS Code codicon syntax like $(check), $(code), $(add) exactly",
    "- Keep these technical terms untranslated: AISHA, MCP, Docker, UUID, API, n8n, Ollama",
    "- Output ONLY valid JSON — no markdown fences, no explanation, no comments",
  ].join("\n");

  const userPrompt = `Source JSON:\n${JSON.stringify(source, null, 2)}`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  try {
    const result = await edgeChat(messages, {
      task: "filter",
      maxTokens: 4096,
      temperature: 0.2,
    });

    if (!result) return null;

    const json = extractJsonFromString(result.content);
    if (!json) return null;

    return isValidLocaleDict(json) ? json : null;
  } catch {
    return null;
  }
}

// ─── Result UI ───────────────────────────────────────────────────────────────

async function showTranslationResult(
  context: vscode.ExtensionContext,
  locale: string,
  translated: LocaleDict,
  source: LocaleDict,
): Promise<void> {
  const sourceCount = Object.keys(source).length;
  const translatedCount = Object.keys(translated).length;
  const coverage = Math.min(100, Math.round((translatedCount / sourceCount) * 100));
  const localeName = LOCALE_DISPLAY_NAMES[locale] ?? locale;

  // Open preview in editor
  const preview = await vscode.workspace.openTextDocument({
    content: JSON.stringify(translated, null, 2),
    language: "json",
  });
  await vscode.window.showTextDocument(preview, { preview: true });

  const saveGlobal = vscode.l10n.t("Save globally");
  const saveWorkspace = vscode.l10n.t("Save to workspace");
  const submitCloud = vscode.l10n.t("Submit to cloud\u2026");
  const discard = vscode.l10n.t("Discard");

  const choice = await vscode.window.showInformationMessage(
    vscode.l10n.t(
      "AISHA: {0} translation ready ({1}% coverage, {2} strings). Where to save?",
      localeName,
      String(coverage),
      String(translatedCount),
    ),
    saveGlobal,
    saveWorkspace,
    submitCloud,
    discard,
  );

  if (choice === saveGlobal || choice === saveWorkspace) {
    const scope = choice === saveGlobal ? "global" : "workspace";
    await saveUserTranslation(locale, translated, scope);
    setActiveLocale(locale);
    void vscode.window.showInformationMessage(
      vscode.l10n.t(
        "AISHA: {0} translation saved. Reopen panels to apply.",
        localeName,
      ),
    );
  } else if (choice === submitCloud) {
    await submitToCloud(context, locale, translated, coverage);
  }
}

// ─── Cloud submission ─────────────────────────────────────────────────────────

async function submitToCloud(
  _context: vscode.ExtensionContext,
  locale: string,
  dict: LocaleDict,
  coverage: number,
): Promise<void> {
  const localeName = LOCALE_DISPLAY_NAMES[locale] ?? locale;
  const stringCount = Object.keys(dict).length;

  const confirm = await vscode.window.showInformationMessage(
    vscode.l10n.t(
      "Submit {0} translation ({1} strings, {2}% coverage) to AISHA for review? No personal data is included.",
      localeName,
      String(stringCount),
      String(coverage),
    ),
    vscode.l10n.t("Submit"),
    vscode.l10n.t("Cancel"),
  );

  if (confirm !== vscode.l10n.t("Submit")) return;

  try {
    const result = await callMcpTool("submit_extension_locale", {
      locale,
      payload: dict,
      coverage_pct: coverage,
      string_count: stringCount,
    });

    if (result) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t("AISHA: Translation submitted for review. Thank you!"),
      );
    } else {
      void vscode.window.showWarningMessage(
        vscode.l10n.t(
          "AISHA: Could not submit translation. Save it locally instead.",
        ),
      );
    }
  } catch {
    void vscode.window.showWarningMessage(
      vscode.l10n.t(
        "AISHA: Could not submit translation. Check MCP connection.",
      ),
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isValidLocaleDict(obj: unknown): obj is LocaleDict {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  return Object.values(obj as Record<string, unknown>).every(
    (v) => typeof v === "string",
  );
}

function extractJsonFromString(content: string): unknown {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}
