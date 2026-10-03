/**
 * DashboardPanel — Full-width WebviewPanel for AISHA operator surfaces.
 *
 * The main workspace canvas where users work on stories. It opens the web
 * mission-control surface when available, keeps Appsmith as an embedded ops
 * dashboard target, and reacts to profile/auth changes.
 *
 * @module
 */

import * as vscode from "vscode";
import { getDirigentConfig, onConfigChanged } from "../config";
import { getAuthState, onAuthStateChanged, fetchUserStories } from "../auth";
import { resolveStoryContext, persistStoryId } from "../story-context";
import { recordChildProcess } from "../resource-tracker";
import { appendWebPath, buildFrameSrcCsp, getNonce, sanitizeWebviewFrameUrl } from "../webview-security";

import type { StoryItem } from "../auth";

export class DashboardPanel {
  public static readonly viewType = "aisha.dirigent.dashboardPanel";

  private static instance: DashboardPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];
  private onDisconnect: (() => void) | undefined;

  public static show(
    extensionUri: vscode.Uri,
    onDisconnect?: () => void,
  ): DashboardPanel {
    if (DashboardPanel.instance) {
      DashboardPanel.instance.panel.reveal(vscode.ViewColumn.One);
      DashboardPanel.instance.refresh();
      return DashboardPanel.instance;
    }

    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      "AISHA Dashboard",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      },
    );

    const instance = new DashboardPanel(panel, extensionUri, onDisconnect);
    DashboardPanel.instance = instance;
    return instance;
  }

  public static dispose(): void {
    DashboardPanel.instance?.panel.dispose();
  }

  public static isVisible(): boolean {
    return DashboardPanel.instance?.panel.visible ?? false;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    onDisconnect?: () => void,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.onDisconnect = onDisconnect;

    this.panel.webview.html = this.renderHtml();

    // Send initial story context
    void this.sendStoryContext();

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(
      (msg) => void this.handleMessage(msg),
      undefined,
      this.disposables,
    );

    // React to config changes (profile switch → reload iframe)
    this.disposables.push(
      onConfigChanged(() => {
        this.panel.webview.html = this.renderHtml();
        void this.sendStoryContext();
      }),
    );

    // React to auth changes (logout → back to setup)
    this.disposables.push(
      onAuthStateChanged((state) => {
        if (!state.isAuthenticated) {
          this.panel.dispose();
          this.onDisconnect?.();
        }
      }),
    );

    this.panel.onDidDispose(
      () => {
        DashboardPanel.instance = undefined;
        for (const d of this.disposables) d.dispose();
      },
      undefined,
      this.disposables,
    );
  }

  /** Refresh the dashboard HTML (e.g. after profile change). */
  public refresh(): void {
    this.panel.webview.html = this.renderHtml();
    void this.sendStoryContext();
  }

  /** Send story context to the iframe. */
  private async sendStoryContext(): Promise<void> {
    const story = await resolveStoryContext();
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let branch: string | null = null;
    if (root) {
      try {
        const { execSync } = await import("child_process");
        branch = execSync("git rev-parse --abbrev-ref HEAD", {
          cwd: root,
          timeout: 3000,
          encoding: "utf-8",
        }).trim() || null;
        recordChildProcess();
      } catch { /* no git */ }
    }

    void this.panel.webview.postMessage({
      type: "storyContext",
      storyId: story.storyId,
      branch,
    });
  }

  private async handleMessage(msg: Record<string, unknown>): Promise<void> {
    switch (msg.type) {
      case "switchStory":
        await this.handleStorySwitcher();
        break;
      case "disconnect":
        this.panel.dispose();
        this.onDisconnect?.();
        break;
      case "refresh":
        this.refresh();
        break;
    }
  }

  private async handleStorySwitcher(): Promise<void> {
    const auth = getAuthState();
    const config = getDirigentConfig();

    if (!auth.isAuthenticated || !auth.accessToken || !config.aishaUrl) {
      void vscode.window.showWarningMessage("Nejprve se přihlas.");
      return;
    }

    try {
      const stories = await fetchUserStories(
        config.aishaUrl,
        auth.accessToken,
        config.anonKey ?? "",
      );

      if (!stories.length) {
        void vscode.window.showInformationMessage("Žádné dostupné stories.");
        return;
      }

      const items = stories.map((s: StoryItem) => ({
        label: s.is_shared ? `$(people) ${s.title}` : s.title,
        description: s.status,
        detail: s.id,
      }));

      const pick = await vscode.window.showQuickPick(items, {
        title: "Přepnout story",
        placeHolder: "Na kterém projektu chceš pracovat?",
      });

      if (pick?.detail) {
        await persistStoryId(pick.detail);
        void this.sendStoryContext();
        void vscode.window.showInformationMessage(`Story: ${pick.label}`);
      }
    } catch {
      void vscode.window.showWarningMessage("Nepodařilo se načíst stories.");
    }
  }

  /** Resolve the Appsmith dashboard URL from active profile. */
  private resolveDashboardUrl(): string {
    const cfg = getDirigentConfig();
    const profileUrl = cfg.activeProfile && cfg.profiles[cfg.activeProfile]?.dashboardUrl;
    return sanitizeWebviewFrameUrl(profileUrl ?? cfg.dashboardUrl);
  }

  /** Resolve the web frontend URL from active profile. */
  private resolveWebUrl(): string {
    const cfg = getDirigentConfig();
    const profileUrl = cfg.activeProfile && cfg.profiles[cfg.activeProfile]?.webUrl;
    return sanitizeWebviewFrameUrl(profileUrl ?? cfg.webUrl);
  }

  private withWebPath(baseUrl: string, path: string): string {
    return appendWebPath(baseUrl, path);
  }

  private resolveTargets(): Array<{ id: string; label: string; url: string }> {
    const webUrl = this.resolveWebUrl();
    const appsmithUrl = this.resolveDashboardUrl();
    const targets = [
      {
        id: "mission",
        label: "Mission Control",
        url: this.withWebPath(webUrl, "/admin/mission-control"),
      },
      {
        id: "kanban",
        label: "Stories Kanban",
        url: this.withWebPath(webUrl, "/admin/mission-control/kanban"),
      },
      {
        id: "appsmith",
        label: "Appsmith Ops",
        url: appsmithUrl,
      },
    ];

    return targets.filter((target) => target.url.length > 0);
  }

  private renderHtml(): string {
    const cspSource = this.panel.webview.cspSource;
    const nonce = getNonce();
    const targets = this.resolveTargets();
    const defaultTarget = targets[0];
    const dashboardUrl = defaultTarget?.url ?? "";
    const auth = getAuthState();
    const config = getDirigentConfig();

    // Determine connection label
    let connectionLabel = "Not Connected";
    if (config.activeProfile) {
      const profile = config.profiles[config.activeProfile];
      if (profile?.orgName) {
        connectionLabel = profile.orgName;
      } else {
        connectionLabel = config.activeProfile;
      }
    }

    const emailDisplay = auth.email ?? "";
    const hasDashboard = dashboardUrl.length > 0;
    const frameSrc = buildFrameSrcCsp(targets.map((target) => target.url));
    const targetButtons = targets.map((target, index) => `<button class="topbar-btn target-btn${index === 0 ? " active" : ""}" data-url="${escapeAttribute(target.url)}" data-label="${escapeAttribute(target.label)}">${escapeHtml(target.label)}</button>`).join("");

    return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; frame-src ${frameSrc}; img-src ${cspSource} https: http: data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AISHA Dashboard</title>
  <style nonce="${nonce}">
    :root {
      /* AISHA brand tokens — mirror of packages/design-tokens/tokens.json */
      --accent: #FF6A1A;
      --accent-dark: #E55A10;
      --surface: #0E0E10;
      --surface-1: #0A0A0C;
      --surface-2: #16161A;
      --line: rgba(255, 255, 255, 0.12);
      --line-soft: rgba(255, 255, 255, 0.08);
      --fg: rgba(255, 255, 255, 0.92);
      --fg-dim: rgba(255, 255, 255, 0.55);
      --ember-strong: rgba(255, 106, 26, 0.10);
      --skew: -23deg;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body {
      font-family: "Nunito Sans", var(--vscode-font-family, system-ui, -apple-system, "Segoe UI", sans-serif);
      font-size: 13px;
      color: var(--fg);
      background: var(--surface);
      display: flex;
      flex-direction: column;
      height: 100vh;
    }

    .topbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 12px;
      background: var(--surface-1);
      border-bottom: 1px solid var(--line-soft);
      font-size: 12px;
      flex-shrink: 0;
    }
    .topbar .brand-slice {
      width: 11px;
      height: 16px;
      background: var(--accent);
      transform: skewX(var(--skew));
      flex-shrink: 0;
      margin-right: 2px;
    }
    .topbar .title { font-weight: 800; letter-spacing: -0.01em; }
    .pill {
      padding: 3px 10px;
      border: 1px solid var(--line-soft);
      background: var(--surface-2);
      color: var(--fg-dim);
      font-size: 11px;
      max-width: 240px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spacer { flex: 1; }
    .topbar-btn {
      background: none;
      border: 1px solid var(--line);
      color: var(--fg-dim);
      padding: 3px 10px;
      font-size: 11px;
      font-weight: 700;
      font-family: inherit;
      cursor: pointer;
      transition: border-color .18s ease, color .18s ease, background .18s ease;
    }
    .topbar-btn:hover { border-color: var(--accent); color: var(--fg); }
    .topbar-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .topbar-btn.active {
      border-color: var(--accent);
      background: var(--ember-strong);
      color: var(--fg);
    }

    .frame-wrap {
      flex: 1;
      position: relative;
    }
    .frame {
      width: 100%;
      height: 100%;
      border: 0;
    }

    .no-dashboard {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 8px;
      color: var(--fg-dim);
    }
    .no-dashboard .icon {
      width: 52px;
      height: 52px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--ember-strong);
      border: 1px solid rgba(255, 106, 26, 0.35);
      transform: skewX(var(--skew));
      color: var(--accent);
      margin-bottom: 10px;
    }
    .no-dashboard .icon svg {
      width: 24px;
      height: 24px;
      transform: skewX(calc(-1 * var(--skew)));
    }
    .no-dashboard .lead { font-weight: 800; font-size: 14px; color: var(--fg); }
  </style>
</head>
<body>
  <div class="topbar">
    <span class="brand-slice" aria-hidden="true"></span>
    <span class="title" id="surface-title">${escapeHtml(defaultTarget?.label ?? "Dashboard")}</span>
    ${hasDashboard ? `<span class="pill" id="surface-url" title="${escapeAttribute(dashboardUrl)}">${escapeHtml(dashboardUrl)}</span>` : ""}
    <span class="pill">${escapeHtml(connectionLabel)}</span>
    ${emailDisplay ? `<span class="pill">${escapeHtml(emailDisplay)}</span>` : ""}
    <span class="spacer"></span>
    ${targetButtons}
    <button class="topbar-btn" id="btn-story">Přepnout story</button>
    <button class="topbar-btn" id="btn-refresh">↻</button>
    <button class="topbar-btn" id="btn-disconnect">Odpojit</button>
  </div>

  <div class="frame-wrap">
    ${hasDashboard
      ? `<iframe id="dashboard" class="frame" src="${escapeAttribute(dashboardUrl)}" referrerpolicy="no-referrer"></iframe>`
      : `<div class="no-dashboard">
          <div class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="9"/><rect x="13.5" y="3.5" width="7" height="5"/><rect x="13.5" y="11.5" width="7" height="9"/><rect x="3.5" y="15.5" width="7" height="5"/></svg></div>
          <div class="lead">Dashboard URL nebyla nalezena</div>
          <div style="font-size:11px;">Přihlas se nebo zkontroluj konfiguraci backendu</div>
        </div>`
    }
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    document.getElementById('btn-story')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'switchStory' });
    });
    document.getElementById('btn-refresh')?.addEventListener('click', () => {
      const iframe = document.getElementById('dashboard');
      if (iframe?.src) iframe.src = iframe.src;
      vscode.postMessage({ type: 'refresh' });
    });
    document.getElementById('btn-disconnect')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'disconnect' });
    });

    document.querySelectorAll('.target-btn').forEach((button) => {
      button.addEventListener('click', () => {
        const iframe = document.getElementById('dashboard');
        const url = button.getAttribute('data-url');
        const label = button.getAttribute('data-label') || 'Dashboard';
        if (iframe && url) iframe.src = url;
        document.querySelectorAll('.target-btn').forEach((btn) => btn.classList.remove('active'));
        button.classList.add('active');
        const title = document.getElementById('surface-title');
        if (title) title.textContent = label;
        const urlPill = document.getElementById('surface-url');
        if (urlPill && url) {
          urlPill.textContent = url;
          urlPill.setAttribute('title', url);
        }
      });
    });

    // Forward story context to iframe
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'storyContext') {
        const iframe = document.getElementById('dashboard');
        if (iframe) {
          try {
            iframe.contentWindow.postMessage(e.data, new URL(iframe.src).origin);
          } catch {
            // Invalid/missing iframe URL; nothing to forward.
          }
        }
      }
    });
  </script>
</body>
</html>`;
  }
}

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return c;
    }
  });
}

function escapeAttribute(input: string): string {
  return escapeHtml(input).replace(/`/g, "&#96;");
}
