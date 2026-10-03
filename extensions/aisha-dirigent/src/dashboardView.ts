/**
 * Dashboard WebView — embeds Appsmith StoryLoop as an iframe.
 *
 * Merged from aisha-workbench-shell into the unified AISHA Dirigent extension.
 * Provides a dashboard-first view with story context sync via postMessage.
 *
 * @module
 */

import * as vscode from "vscode";
import { getDirigentConfig, onConfigChanged } from "./config";
import { resolveStoryContext } from "./story-context";
import { recordChildProcess } from "./resource-tracker";
import { buildFrameSrcCsp, getNonce, sanitizeWebviewFrameUrl } from "./webview-security";

export class DashboardViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "aisha.dirigent.dashboard";

  private webviewView: vscode.WebviewView | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.webviewView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.renderHtml(webviewView.webview);

    // Send story context to the iframe after load
    void this.sendStoryContext();
  }

  /** Send current story context to the embedded dashboard */
  async sendStoryContext(): Promise<void> {
    if (!this.webviewView) return;
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

    void this.webviewView.webview.postMessage({
      type: "storyContext",
      storyId: story.storyId,
      branch,
    });
  }

  private renderHtml(webview: vscode.Webview): string {
    const cfg = getDirigentConfig();
    const cspSource = webview.cspSource;
    const nonce = getNonce();
    // Per-profile dashboardUrl takes priority, then global setting, then default
    const profileUrl = cfg.activeProfile && cfg.profiles[cfg.activeProfile]?.dashboardUrl;
    const dashboardUrl = sanitizeWebviewFrameUrl(profileUrl ?? cfg.dashboardUrl)
      || sanitizeWebviewFrameUrl("http://localhost:8090");
    const frameSrc = buildFrameSrcCsp([dashboardUrl]);

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; frame-src ${frameSrc}; img-src ${cspSource} https: http: data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AISHA Dashboard</title>
    <style nonce="${nonce}">
      html, body { height: 100%; padding: 0; margin: 0; }
      .wrap { height: 100%; display: flex; flex-direction: column; }
      .bar { padding: 8px 10px; font: 12px/1.4 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; border-bottom: 1px solid rgba(127,127,127,.25); }
      .frame { flex: 1; border: 0; width: 100%; }
      .hint { opacity: .75; }
      .row { display: flex; align-items: center; gap: 8px; }
      .pill { padding: 2px 6px; border-radius: 999px; background: rgba(127,127,127,.2); font-size: 11px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="bar">
        <div class="row">
          <strong>Dashboard</strong>
          <span class="pill">${escapeHtml(dashboardUrl)}</span>
          <span class="hint">Appsmith embed</span>
        </div>
      </div>
      <iframe id="dashboard" class="frame" src="${escapeAttribute(dashboardUrl)}" referrerpolicy="no-referrer"></iframe>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      window.addEventListener("message", (e) => {
        // Forward story context to iframe
        if (e.data?.type === "storyContext") {
          const iframe = document.getElementById("dashboard");
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
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return c;
    }
  });
}

function escapeAttribute(input: string): string {
  return escapeHtml(input).replace(/`/g, "&#96;");
}
