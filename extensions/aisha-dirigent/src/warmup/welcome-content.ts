/**
 * Welcome Content Provider — allows marketplace extensions and Workbench
 * to customize parts of the welcome/warmup flow.
 *
 * Architecture:
 * - Extension walkthrough (package.json contributes.walkthroughs) = base content
 * - This module provides a registration API for custom content sections
 * - Marketplace updates can ship new SVGs, descriptions, step overrides
 * - Workbench IDE provides full warmup via WarmupFlowProvider (Phase 3.2)
 *
 * Content sections that can be customized:
 * - welcomeHero: headline, subtitle, features list
 * - dashboardEmbed: URL + title for embedded dashboard (Appsmith, NocoDB, custom)
 * - quickActions: array of {label, command, icon} shown on the ready step
 * - branding: logo SVG path, accent color override
 *
 * @module
 */

import * as vscode from "vscode";

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

export interface WelcomeHeroContent {
  headline?: string;
  subtitle?: string;
  features?: Array<{ label: string; icon?: string }>;
}

export interface DashboardEmbedContent {
  url: string;
  title: string;
  height?: number;
}

export interface QuickAction {
  label: string;
  command: string;
  icon?: string;
  args?: unknown[];
}

export interface BrandingOverride {
  logoPath?: string;
  accentColor?: string;
  productName?: string;
}

export interface WelcomeContentOverrides {
  welcomeHero?: WelcomeHeroContent;
  dashboardEmbed?: DashboardEmbedContent;
  quickActions?: QuickAction[];
  branding?: BrandingOverride;
}

// ──────────────────────────────────────────
// Registry
// ──────────────────────────────────────────

let _overrides: WelcomeContentOverrides = {};

const _onContentChanged = new vscode.EventEmitter<WelcomeContentOverrides>();
/** Fires when welcome content is updated (by marketplace extension or Workbench). */
export const onWelcomeContentChanged: vscode.Event<WelcomeContentOverrides> = _onContentChanged.event;

/**
 * Register welcome content overrides.
 * Called by Workbench or marketplace extensions to customize the welcome flow.
 * Merges with existing overrides (last writer wins per section).
 */
export function registerWelcomeContent(overrides: Partial<WelcomeContentOverrides>): void {
  _overrides = { ..._overrides, ...overrides };
  _onContentChanged.fire(_overrides);
}

/**
 * Get current welcome content (base + overrides).
 */
export function getWelcomeContent(): WelcomeContentOverrides {
  return { ..._overrides };
}

/**
 * Reset to default content (useful for testing).
 */
export function resetWelcomeContent(): void {
  _overrides = {};
  _onContentChanged.fire(_overrides);
}

// ──────────────────────────────────────────
// Configuration-based overrides
// ──────────────────────────────────────────

/**
 * Load welcome content overrides from VS Code settings.
 * Allows marketplace extension updates to ship new content
 * via `configurationDefaults` in package.json.
 *
 * Settings namespace: `aisha.welcome.*`
 */
export function loadWelcomeContentFromConfig(): void {
  const config = vscode.workspace.getConfiguration("aisha.welcome");

  const headline = config.get<string>("headline");
  const subtitle = config.get<string>("subtitle");
  const dashboardUrl = config.get<string>("dashboardUrl");
  const dashboardTitle = config.get<string>("dashboardTitle");
  const quickActions = config.get<QuickAction[]>("quickActions");
  const accentColor = config.get<string>("accentColor");

  const overrides: WelcomeContentOverrides = {};

  if (headline || subtitle) {
    overrides.welcomeHero = {};
    if (headline) overrides.welcomeHero.headline = headline;
    if (subtitle) overrides.welcomeHero.subtitle = subtitle;
  }

  if (dashboardUrl) {
    overrides.dashboardEmbed = {
      url: dashboardUrl,
      title: dashboardTitle ?? "Dashboard",
    };
  }

  if (quickActions?.length) {
    overrides.quickActions = quickActions;
  }

  if (accentColor) {
    overrides.branding = { accentColor };
  }

  if (Object.keys(overrides).length > 0) {
    registerWelcomeContent(overrides);
  }
}
