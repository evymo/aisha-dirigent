/**
 * i18n Overlay — supplementary localization for webviews and custom locales.
 *
 * Extends VS Code's built-in vscode.l10n system with:
 * - User-generated translations stored in globalStorage / workspace
 * - Webview string injection (SetupPanel, questionnaire item labels)
 * - Custom locales beyond what VS Code supports natively
 *
 * Resolution order (later sources override earlier ones):
 *   1. Bundled EN base  (extension resources/i18n/en.json)
 *   2. Bundled <locale> (extension resources/i18n/<locale>.json)
 *   3. GlobalStorage    (<globalStorageUri>/i18n/<locale>.json)
 *   4. Workspace        (.aisha/i18n/<locale>.json)
 *
 * @module i18n/overlay
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { safeWriteJson } from "../generators/file-safety";

// ─── Types ───────────────────────────────────────────────────────────────────

export type LocaleDict = Record<string, string>;

// ─── State ───────────────────────────────────────────────────────────────────

let _context: vscode.ExtensionContext | undefined;
let _activeLocale: string = "en";
const _cache = new Map<string, LocaleDict>();

// ─── Init ────────────────────────────────────────────────────────────────────

/**
 * Initialize the overlay system.
 * Must be called during extension activation before any UI is rendered.
 */
export function initOverlay(context: vscode.ExtensionContext): void {
  _context = context;
  _activeLocale = resolveActiveLocale();
}

function resolveActiveLocale(): string {
  const override = vscode.workspace
    .getConfiguration("aisha.dirigent")
    .get<string>("languageOverride");
  if (override && override !== "auto") {
    return override.split("-")[0].toLowerCase();
  }
  return (vscode.env.language ?? "en").split("-")[0].toLowerCase();
}

// ─── Getters / setters ───────────────────────────────────────────────────────

export function getActiveLocale(): string {
  return _activeLocale;
}

/**
 * Change the active overlay locale and invalidate the cache.
 * Persists the choice to VS Code global settings.
 * Note: Does NOT affect vscode.l10n, which follows vscode.env.language.
 */
export function setActiveLocale(locale: string): void {
  _activeLocale = locale.split("-")[0].toLowerCase();
  _cache.clear();
  void vscode.workspace
    .getConfiguration("aisha.dirigent")
    .update("languageOverride", _activeLocale, vscode.ConfigurationTarget.Global);
}

// ─── Loading ─────────────────────────────────────────────────────────────────

/**
 * Load locale dictionary synchronously (usable in HTML render functions and QuickPick builders).
 * Applies the full resolution chain with caching.
 */
export function loadLocaleSync(locale: string): LocaleDict {
  const normalizedLocale = locale.split("-")[0].toLowerCase();
  if (_cache.has(normalizedLocale)) return _cache.get(normalizedLocale)!;

  const dict: LocaleDict = {};

  // 1. Bundled EN base
  Object.assign(dict, loadBundledSync("en"));

  // 2. Bundled target locale (skip for EN)
  if (normalizedLocale !== "en") {
    Object.assign(dict, loadBundledSync(normalizedLocale));
  }

  // 3. GlobalStorage user translations
  if (_context) {
    const globalPath = path.join(
      _context.globalStorageUri.fsPath,
      "i18n",
      `${normalizedLocale}.json`,
    );
    Object.assign(dict, loadJsonSafe(globalPath));
  }

  // 4. Workspace-local overrides (highest priority)
  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  if (wsFolder) {
    const wsPath = path.join(
      wsFolder.uri.fsPath,
      ".aisha",
      "i18n",
      `${normalizedLocale}.json`,
    );
    Object.assign(dict, loadJsonSafe(wsPath));
  }

  _cache.set(normalizedLocale, dict);
  return dict;
}

/**
 * Translate a key using the active locale with EN fallback.
 * `ot` = overlay translate (distinguish from vscode.l10n.t).
 */
export function ot(key: string, locale?: string): string {
  const loc = locale ?? _activeLocale;
  const dict = loadLocaleSync(loc);
  if (dict[key]) return dict[key];
  // EN fallback
  if (loc !== "en") {
    const en = loadLocaleSync("en");
    if (en[key]) return en[key];
  }
  return key;
}

// ─── Discovery ───────────────────────────────────────────────────────────────

/**
 * List locale codes for which at least one translation file exists.
 * Includes bundled, globalStorage, and workspace locales.
 */
export function listAvailableLocales(): string[] {
  const locales = new Set<string>(["en"]);

  // Bundled
  if (_context) {
    const i18nDir = path.join(_context.extensionPath, "resources", "i18n");
    if (fs.existsSync(i18nDir)) {
      for (const f of fs.readdirSync(i18nDir)) {
        const m = f.match(/^([a-z]{2,3})\.json$/);
        if (m) locales.add(m[1]);
      }
    }
  }

  // GlobalStorage user-generated
  if (_context) {
    const globalDir = path.join(_context.globalStorageUri.fsPath, "i18n");
    if (fs.existsSync(globalDir)) {
      for (const f of fs.readdirSync(globalDir)) {
        const m = f.match(/^([a-z]{2,3})\.json$/);
        if (m) locales.add(m[1]);
      }
    }
  }

  // Workspace
  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  if (wsFolder) {
    const wsDir = path.join(wsFolder.uri.fsPath, ".aisha", "i18n");
    if (fs.existsSync(wsDir)) {
      for (const f of fs.readdirSync(wsDir)) {
        const m = f.match(/^([a-z]{2,3})\.json$/);
        if (m) locales.add(m[1]);
      }
    }
  }

  return [...locales].sort();
}

// ─── Persistence ─────────────────────────────────────────────────────────────

/**
 * Persist a user-generated or user-edited locale dictionary.
 * scope "global" → globalStorage (all workspaces)
 * scope "workspace" → .aisha/i18n/<locale>.json in current workspace
 */
export async function saveUserTranslation(
  locale: string,
  dict: LocaleDict,
  scope: "global" | "workspace",
): Promise<void> {
  if (scope === "workspace") {
    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    if (!wsFolder) throw new Error("No workspace folder open");

    // `.aisha/i18n/<locale>.json` is explicitly user-edited; route the write
    // through safeWriteJson so the prior version is backed up (+ rotated) under
    // .aisha/backups/ before being replaced. Merge into the existing dict first
    // to preserve the prior overwrite-only-new-keys semantics.
    const relPath = path.posix.join(".aisha", "i18n", `${locale}.json`);
    const targetPath = path.join(wsFolder.uri.fsPath, ".aisha", "i18n", `${locale}.json`);
    const existing = loadJsonSafe(targetPath);
    const merged = { ...existing, ...dict };
    const written = JSON.stringify(merged, null, 2) + "\n";

    const outcome = await safeWriteJson(wsFolder.uri, relPath, written);
    if (outcome.outcome === "backup-failed") {
      throw new Error(`Failed to back up existing translation before write: ${relPath}`);
    }
  } else {
    if (!_context) throw new Error("Overlay not initialized (call initOverlay first)");
    const targetPath = path.join(_context.globalStorageUri.fsPath, "i18n", `${locale}.json`);
    const existing = loadJsonSafe(targetPath);
    const merged = { ...existing, ...dict };
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
  }

  // Invalidate cache for this locale
  _cache.delete(locale);
}

/**
 * Load the raw source EN dictionary (for AI translation input).
 */
export function loadSourceDict(): LocaleDict {
  return loadBundledSync("en");
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function loadBundledSync(locale: string): LocaleDict {
  if (!_context) return {};
  const p = path.join(_context.extensionPath, "resources", "i18n", `${locale}.json`);
  return loadJsonSafe(p);
}

function loadJsonSafe(filePath: string): LocaleDict {
  try {
    if (!fs.existsSync(filePath)) return {};
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content) as LocaleDict;
  } catch {
    return {};
  }
}
