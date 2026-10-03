/**
 * SetupPanel — WebviewPanel for initial backend connection setup.
 *
 * Presents 3 connection modes (Cloud / Local / Custom Backend),
 * handles authentication, fetches workspace config (dashboard URL),
 * and transitions to DashboardPanel on completion.
 *
 * State machine: ModeSelect → Connect → Auth → Loading → Complete
 *
 * @module
 */

import * as vscode from "vscode";
import type { ChildProcessWithoutNullStreams } from "child_process";
import { getDirigentConfig, switchProfile, onConfigChanged, updateLocalConfig } from "../config";
import { deriveBootstrapUrl, ensureBootstrapConfig, fetchWorkspaceConfig, persistWorkspaceConfig } from "../bootstrap";
import { getAuthState, loginWithAishaId, onAuthStateChanged, signup } from "../auth";
import { scanEnvironment } from "../warmup/environment-detector";
import { recordChildProcess } from "../resource-tracker";
import { getNonce } from "../webview-security";
// Shared bring-up contract (single source of truth) — the SAME entry-point every
// IDE/agent integration uses. esbuild bundles this .mjs into the extension build.
// @ts-expect-error — .mjs SoT module lives outside rootDir; esbuild resolves it at bundle time.
import { STACK_BRINGUP_ARGS } from "../../../../scripts/lib/bringup-contract.mjs";

import type { ConnectionProfile, DirigentConfig } from "../config";
import type { WarmupEnvironment } from "../warmup/environment-detector";

/** Final machine-readable status line emitted by `npm run stack:bringup -- --json`. */
interface BringupResult {
  preset: string | null;
  apps: string | null;
  composeFile: string | null;
  envFile: string | null;
  healthy: boolean;
  services: Array<{ name: string; status: string; http_code?: string; stack?: string }>;
  gatewayUrl: string | null;
}

type SetupStep = "mode-select" | "connecting" | "auth" | "loading" | "complete";

/** Message types sent from webview to extension host. */
interface WebviewMessage {
  type: string;
  mode?: "cloud" | "local" | "custom";
  url?: string;
  action?: "login" | "signup";
  email?: string;
  password?: string;
}

export class SetupPanel {
  public static readonly viewType = "aisha.dirigent.setup";

  private static instance: SetupPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private currentStep: SetupStep = "mode-select";
  private selectedMode: "cloud" | "local" | "custom" | null = null;
  private environment: WarmupEnvironment | null = null;
  private disposables: vscode.Disposable[] = [];
  private onComplete: (() => void) | undefined;
  private bringupProc: ChildProcessWithoutNullStreams | undefined;

  public static show(
    extensionUri: vscode.Uri,
    onComplete?: () => void,
  ): SetupPanel {
    if (SetupPanel.instance) {
      SetupPanel.instance.panel.reveal(vscode.ViewColumn.One);
      if (onComplete) {
        SetupPanel.instance.onComplete = onComplete;
      }
      return SetupPanel.instance;
    }

    const panel = vscode.window.createWebviewPanel(
      SetupPanel.viewType,
      "AISHA — Setup",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      },
    );

    const instance = new SetupPanel(panel, extensionUri, onComplete);
    SetupPanel.instance = instance;
    return instance;
  }

  public static dispose(): void {
    SetupPanel.instance?.panel.dispose();
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    onComplete?: () => void,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.onComplete = onComplete;

    this.panel.webview.html = this.renderHtml();

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => void this.handleMessage(msg),
      undefined,
      this.disposables,
    );

    this.disposables.push({
      dispose: () => {
        // Kill any in-flight local bring-up so it does not outlive the panel.
        if (this.bringupProc && this.bringupProc.exitCode === null) {
          try { this.bringupProc.kill(); } catch { /* already gone */ }
        }
        this.bringupProc = undefined;
      },
    });

    this.panel.onDidDispose(
      () => {
        SetupPanel.instance = undefined;
        for (const d of this.disposables) d.dispose();
      },
      undefined,
      this.disposables,
    );
  }

  // ──────────────────────────────────────────
  // Message handler
  // ──────────────────────────────────────────

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case "selectMode":
        await this.handleModeSelect(msg.mode!);
        break;

      case "customConnect":
        await this.handleCustomConnect(msg.url!);
        break;

      case "auth":
        await this.handleAuth(msg.action!, msg.email!, msg.password!);
        break;

      case "skipAuth":
        this.transitionToComplete();
        break;

      case "deployLocalStack":
        await this.handleDeployLocalStack();
        break;

      case "openDashboard":
        this.panel.dispose();
        this.onComplete?.();
        break;
    }
  }

  // ──────────────────────────────────────────
  // Mode handlers
  // ──────────────────────────────────────────

  private async handleModeSelect(mode: "cloud" | "local" | "custom"): Promise<void> {
    this.selectedMode = mode;

    if (mode === "cloud") {
      this.setStep("connecting");
      this.postMessage({ type: "status", text: "Connecting to AISHA Cloud..." });

      // Ensure cloud profile exists and bootstrap anonKey
      const config = getDirigentConfig();
      const profiles = Object.keys(config.profiles);

      // Create or switch to cloud profile
      const cloudTLD = vscode.workspace
        .getConfiguration("aisha.dirigent")
        .get<string>("cloudTLD") ?? "";
      const cloudApiUrl = cloudTLD ? `https://api.${cloudTLD}` : "";
      const cloudBootstrapUrl = cloudApiUrl
        ? `${cloudApiUrl}/.well-known/app-config.json`
        : "";
      if (!profiles.includes("cloud")) {
        await this.createProfile("cloud", {
          aishaUrl: cloudApiUrl,
          bootstrapUrl: cloudBootstrapUrl,
        });
      }
      await switchProfile("cloud");

      // Bootstrap anonKey. No `overwriteExisting` — persistBootstrapToLocal must
      // fill only the bootstrap-derived keys that are still missing, never clobber
      // connection overrides a user already set in dirigent.local.json. `force` is
      // unnecessary: currentAnonKey is undefined here, so the fetch runs anyway.
      const result = await ensureBootstrapConfig(
        "cloud",
        cloudBootstrapUrl,
        undefined,
      );
      if (!result.anonKey) {
        this.postMessage({
          type: "error",
          text: "Could not connect to AISHA Cloud. Check your network connection.",
        });
        this.setStep("mode-select");
        return;
      }

      this.setStep("auth");
      this.postMessage({ type: "stepChanged", step: "auth", mode: "cloud" });

    } else if (mode === "local") {
      this.setStep("connecting");
      this.postMessage({ type: "status", text: "Scanning local services..." });

      // Scan environment
      this.environment = await scanEnvironment();

      // Create or switch to local profile
      const config = getDirigentConfig();
      if (!Object.keys(config.profiles).includes("local")) {
        await this.createProfile("local", {
          aishaUrl: "http://localhost:57421",
        });
      }
      await switchProfile("local");

      // Send scan results to webview
      this.postMessage({
        type: "scanResults",
        services: this.environment.services,
        hasBackend: this.environment.hasBackend,
        hasAiModel: this.environment.hasAiModel,
      });

      // If backend is available, show auth step; otherwise show results only
      if (this.environment.hasBackend) {
        this.setStep("auth");
        this.postMessage({ type: "stepChanged", step: "auth", mode: "local" });
      } else {
        this.postMessage({ type: "stepChanged", step: "scan-results", mode: "local" });
      }

    } else if (mode === "custom") {
      this.postMessage({ type: "stepChanged", step: "custom-url", mode: "custom" });
    }
  }

  private async handleCustomConnect(url: string): Promise<void> {
    this.selectedMode = "custom";
    this.setStep("connecting");
    this.postMessage({ type: "status", text: `Testing connection to ${url}...` });

    // Test the URL
    const reachable = await this.testConnection(url);
    if (!reachable) {
      this.postMessage({
        type: "error",
        text: `Cannot reach ${url}. Check the URL and try again.`,
      });
      this.postMessage({ type: "stepChanged", step: "custom-url", mode: "custom" });
      return;
    }

    // Create custom profile
    const normalizedUrl = url.replace(/\/+$/, "");
    const bootstrapUrl = deriveBootstrapUrl(normalizedUrl);
    await this.createProfile("custom", {
      aishaUrl: normalizedUrl,
      bootstrapUrl,
    });
    await switchProfile("custom");

    // Try bootstrap. No `overwriteExisting` — only fill bootstrap-derived keys
    // still missing in dirigent.local.json, preserving any user-set connection
    // overrides for this custom profile. `force` is unnecessary (currentAnonKey
    // is undefined here, so the fetch runs regardless).
    await ensureBootstrapConfig("custom", bootstrapUrl, undefined);

    this.setStep("auth");
    this.postMessage({ type: "stepChanged", step: "auth", mode: "custom" });
  }

  private async handleAuth(
    action: string,
    _email: string,
    _password: string,
  ): Promise<void> {
    this.setStep("loading");
    this.postMessage({ type: "status", text: "Opening AISHA ID..." });

    try {
      if (action === "signup") {
        await signup({ skipStoryPick: true });
        this.postMessage({
          type: "authInfo",
          text: "Complete registration in the browser, then sign in with AISHA ID.",
        });
        this.setStep("auth");
        return;
      }

      const loggedIn = await loginWithAishaId({ skipStoryPick: true });
      if (!loggedIn) {
        this.setStep("auth");
        return;
      }

      this.postMessage({ type: "status", text: "Loading workspace configuration..." });
      const config = getDirigentConfig();
      const authState = getAuthState();
      const wsConfig = await fetchWorkspaceConfig(
        config.aishaUrl,
        authState.accessToken ?? "",
        config.anonKey ?? "",
      );

      if (wsConfig) {
        persistWorkspaceConfig(config.activeProfile, wsConfig);
      }

      this.transitionToComplete();
    } catch (err) {
      this.postMessage({
        type: "authError",
        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
      });
      this.setStep("auth");
    }
  }

  private async handleDeployLocalStack(): Promise<void> {
    // Idempotent: if a bring-up is already running, do not spawn a second one —
    // just re-surface the in-progress state to the webview.
    if (this.bringupProc && this.bringupProc.exitCode === null) {
      this.postMessage({
        type: "deployStarted",
        text: "Lokální stack se už spouští… (probíhá)",
      });
      return;
    }

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      this.postMessage({
        type: "deployTimedOut",
        text: "Není otevřený žádný workspace — otevři repo orchestrátoru a zkus to znovu.",
      });
      return;
    }

    const { spawn } = await import("child_process");
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

    // `stack:bringup` already passes --json; the trailing `-- --json` is an
    // explicit, harmless reaffirmation that survives any script edit and keeps
    // the final stdout line machine-parseable. The argv comes from the shared
    // bring-up contract (STACK_BRINGUP_ARGS) so the command is defined once.
    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawn(npmCmd, STACK_BRINGUP_ARGS, {
        cwd: root,
        env: process.env,
      });
    } catch (err) {
      this.postMessage({
        type: "deployTimedOut",
        text: `Nepodařilo se spustit bring-up: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    this.bringupProc = proc;
    recordChildProcess();

    this.postMessage({
      type: "deployStarted",
      text: "Spouštím lokální AISHA stack (npm run stack:bringup)… sleduj průběh níže.",
    });

    // Under --json the script routes human banners to stderr and prints exactly
    // one JSON status line on stdout. We stream both to the webview for progress
    // and keep the last brace-delimited stdout line we can parse as the result.
    let stdoutBuf = "";
    let lastJson: BringupResult | undefined;

    const tryParseLines = (chunk: string): void => {
      stdoutBuf += chunk;
      const lines = stdoutBuf.split("\n");
      // Keep the trailing partial line in the buffer.
      stdoutBuf = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith("{") && line.endsWith("}")) {
          try {
            lastJson = JSON.parse(line) as BringupResult;
          } catch { /* not the JSON status line — ignore */ }
        }
        // Stream a trimmed progress tail to the webview deploy-status panel.
        this.postMessage({ type: "deployStarted", text: line.slice(0, 240) });
      }
    };

    proc.stdout.on("data", (d: Buffer) => tryParseLines(d.toString()));
    // The script routes human banners to stderr under --json; surface them too.
    proc.stderr.on("data", (d: Buffer) => {
      const text = d.toString().trim();
      if (text) this.postMessage({ type: "deployStarted", text: text.slice(0, 240) });
    });

    proc.on("error", (err: Error) => {
      if (this.bringupProc !== proc) return; // superseded / cancelled
      this.bringupProc = undefined;
      this.postMessage({
        type: "deployTimedOut",
        text: `Bring-up selhal: ${err.message}`,
      });
    });

    proc.on("close", (code: number | null) => {
      if (this.bringupProc !== proc) return; // panel disposed / cancelled mid-run
      this.bringupProc = undefined;

      // Flush any trailing buffered line as a potential JSON result.
      const tail = stdoutBuf.trim();
      if (tail.startsWith("{") && tail.endsWith("}")) {
        try { lastJson = JSON.parse(tail) as BringupResult; } catch { /* ignore */ }
      }

      void this.finishDeploy(code, lastJson);
    });
  }

  /**
   * Resolve the outcome of a `stack:bringup` run: on a healthy stack, persist the
   * discovered gateway URL into the local profile and advance to auth; otherwise
   * surface a clear failure to the webview.
   */
  private async finishDeploy(
    code: number | null,
    result: BringupResult | undefined,
  ): Promise<void> {
    const healthy = code === 0 && result?.healthy === true;

    if (!healthy) {
      const reason = result
        ? `stack není healthy (gateway: ${result.gatewayUrl ?? "?"}).`
        : `bring-up skončil s kódem ${code ?? "?"}.`;
      this.postMessage({
        type: "deployTimedOut",
        text: `Lokální stack se nepodařilo plně nastartovat — ${reason} Zkontroluj Docker a zkus to znovu.`,
      });
      return;
    }

    // Pin the local profile to the gateway the bring-up actually exposed.
    if (result?.gatewayUrl) {
      await this.createProfile("local", { aishaUrl: result.gatewayUrl });
      await switchProfile("local");
    }

    // Refresh the detected environment so the scan panel reflects reality.
    this.environment = await scanEnvironment();
    this.postMessage({
      type: "scanResults",
      services: this.environment.services,
      hasBackend: this.environment.hasBackend,
      hasAiModel: this.environment.hasAiModel,
    });

    this.postMessage({
      type: "deployStarted",
      text: `Lokální stack je healthy. Gateway: ${result?.gatewayUrl ?? "http://localhost:3001"}`,
    });

    this.setStep("auth");
    this.postMessage({ type: "stepChanged", step: "auth", mode: "local" });
  }

  // ──────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────

  private transitionToComplete(): void {
    this.setStep("complete");
    const config = getDirigentConfig();
    const profileUrl = config.activeProfile && config.profiles[config.activeProfile]?.dashboardUrl;
    const dashboardUrl = profileUrl ?? config.dashboardUrl ?? "";
    const auth = getAuthState();

    this.postMessage({
      type: "setupComplete",
      dashboardUrl,
      email: auth.email ?? "",
      connectionLabel: this.selectedMode ?? "unknown",
    });
  }

  private async createProfile(
    name: string,
    profile: ConnectionProfile,
  ): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return;

    const { existsSync, readFileSync, writeFileSync, mkdirSync } = await import("fs");
    const { join } = await import("path");

    const dirPath = join(root, ".aisha");
    const localPath = join(dirPath, "dirigent.local.json");

    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }

    let existing: Record<string, unknown> = {};
    if (existsSync(localPath)) {
      try {
        existing = JSON.parse(readFileSync(localPath, "utf8")) as Record<string, unknown>;
      } catch {
        existing = {};
      }
    }

    const profiles = (existing.profiles ?? {}) as Record<string, unknown>;
    profiles[name] = { ...(profiles[name] as object ?? {}), ...profile };
    existing.profiles = profiles;
    existing.activeProfile = name;

    writeFileSync(localPath, JSON.stringify(existing, null, 2) + "\n", "utf8");
  }

  private async testConnection(url: string): Promise<boolean> {
    try {
      const normalizedUrl = url.replace(/\/+$/, "");
      const response = await fetch(`${normalizedUrl}/rest/v1/`, {
        method: "GET",
        signal: AbortSignal.timeout(8_000),
      });
      return response.status < 500;
    } catch {
      return false;
    }
  }

  private setStep(step: SetupStep): void {
    this.currentStep = step;
  }

  private postMessage(msg: Record<string, unknown>): void {
    void this.panel.webview.postMessage(msg);
  }

  // ──────────────────────────────────────────
  // HTML Render
  // ──────────────────────────────────────────

  private renderHtml(): string {
    const cspSource = this.panel.webview.cspSource;
    const nonce = getNonce();

    return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${cspSource} https: data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AISHA Setup</title>
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
      --fg-faint: rgba(255, 255, 255, 0.40);
      --ember-strong: rgba(255, 106, 26, 0.10);
      --ember-soft: rgba(255, 106, 26, 0.05);
      --success: #4ADE80;
      --error: #F87171;
      --info: #60A5FA;
      --skew: -23deg;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Nunito Sans", var(--vscode-font-family, system-ui, -apple-system, "Segoe UI", sans-serif);
      font-size: 13px;
      color: var(--fg);
      background: var(--surface);
      display: flex;
      justify-content: center;
      padding: 56px 20px 48px;
      min-height: 100vh;
    }
    /* faint ember glow behind the header — editorial canvas stays near-flat */
    body::before {
      content: "";
      position: fixed;
      top: -220px; left: 50%;
      width: 720px; height: 420px;
      transform: translateX(-50%);
      background: radial-gradient(closest-side, rgba(255, 106, 26, 0.09), transparent 70%);
      pointer-events: none;
    }

    .container { max-width: 560px; width: 100%; position: relative; }

    .logo {
      text-align: center;
      margin-bottom: 36px;
    }
    .logo .mark {
      width: 76px;
      height: 76px;
      margin: 0 auto 18px;
    }
    .logo .mark svg {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      box-shadow: 0 0 0 1px rgba(255, 106, 26, 0.35), 0 0 44px rgba(255, 106, 26, 0.16);
    }
    .logo .eyebrow {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--accent);
      margin-bottom: 10px;
    }
    .logo h1 {
      font-size: 27px;
      font-weight: 900;
      line-height: 1.1;
      letter-spacing: -0.02em;
      margin-bottom: 8px;
    }
    .logo h1 .accent { color: var(--accent); }
    .logo .subtitle {
      color: var(--fg-dim);
      font-size: 13px;
    }

    /* Mode cards */
    .cards { display: flex; flex-direction: column; gap: 12px; }
    .card {
      padding: 16px 20px;
      border: 1px solid var(--line);
      background: var(--surface-2);
      cursor: pointer;
      transition: border-color .18s ease, background .18s ease;
      display: flex;
      align-items: center;
      gap: 18px;
    }
    .card:hover {
      border-color: var(--accent);
      background: var(--ember-soft);
    }
    .card .icon {
      flex-shrink: 0;
      width: 46px;
      height: 46px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--ember-strong);
      border: 1px solid rgba(255, 106, 26, 0.35);
      transform: skewX(var(--skew));
      color: var(--accent);
    }
    .card .icon svg {
      width: 22px;
      height: 22px;
      transform: skewX(calc(-1 * var(--skew)));
    }
    .card .text { flex: 1; }
    .card .text h3 { font-size: 14px; font-weight: 800; margin-bottom: 3px; }
    .card .text p { font-size: 12px; color: var(--fg-dim); }
    .card .card-arrow {
      font-weight: 900;
      color: var(--accent);
      opacity: 0;
      transform: translateX(-4px);
      transition: opacity .18s ease, transform .18s ease;
    }
    .card:hover .card-arrow { opacity: 1; transform: translateX(0); }

    /* Auth form */
    .auth-form { display: flex; flex-direction: column; gap: 12px; }
    .form-group { display: flex; flex-direction: column; gap: 4px; }
    .form-group label { font-size: 12px; font-weight: 700; }
    .form-group input,
    .url-form input {
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 0;
      background: var(--surface-1);
      color: var(--fg);
      font-size: 13px;
      font-family: inherit;
      outline: none;
      transition: border-color .18s ease;
    }
    .form-group input:focus,
    .url-form input:focus { border-color: var(--accent); }
    input::placeholder { color: var(--fg-faint); }

    /* Buttons: slice = brand skew CTA, ghost = quiet link */
    .btn {
      border: none;
      font-size: 13px;
      cursor: pointer;
      font-weight: 800;
      font-family: inherit;
    }
    .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
    .btn-primary {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 11px 24px;
      background: var(--accent);
      color: #fff;
      transform: skewX(var(--skew));
      transition: background .18s ease;
    }
    .btn-primary > span {
      display: inline-block;
      transform: skewX(calc(-1 * var(--skew)));
    }
    .btn-primary:hover { background: var(--accent-dark); }
    .btn-secondary {
      padding: 11px 6px;
      background: none;
      color: var(--fg-dim);
      font-weight: 700;
      text-decoration: underline;
      text-underline-offset: 4px;
    }
    .btn-secondary:hover { color: var(--fg); }

    .btn-row { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; margin-top: 10px; }

    /* Status */
    .status {
      text-align: center;
      padding: 32px 24px;
      font-size: 13px;
      color: var(--fg-dim);
    }
    .spinner {
      width: 26px; height: 26px;
      border: 2px solid var(--line);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin .8s linear infinite;
      margin: 0 auto 14px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .spinner { animation-duration: 2s; }
      .card .card-arrow { transition: none; }
    }

    .error {
      color: var(--error);
      padding: 10px 14px;
      border-left: 3px solid var(--error);
      background: rgba(248, 113, 113, 0.08);
      font-size: 12px;
      margin-bottom: 10px;
    }
    .info {
      color: var(--info);
      padding: 10px 14px;
      border-left: 3px solid var(--info);
      background: rgba(96, 165, 250, 0.08);
      font-size: 12px;
      margin-bottom: 10px;
    }

    /* Service scan results */
    .services { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
    .service {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 14px;
      border: 1px solid var(--line-soft);
      background: var(--surface-2);
      font-size: 12px;
    }
    .service .dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .service .dot.on { background: var(--success); box-shadow: 0 0 6px rgba(74, 222, 128, 0.5); }
    .service .dot.off { background: #3A3A40; }

    /* Complete screen */
    .complete { text-align: center; padding: 24px 0; }
    .complete .check {
      width: 56px;
      height: 56px;
      margin: 0 auto 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--accent);
      transform: skewX(var(--skew));
    }
    .complete .check svg {
      width: 28px;
      height: 28px;
      transform: skewX(calc(-1 * var(--skew)));
      color: #fff;
    }
    .complete h2 {
      font-size: 24px;
      font-weight: 900;
      letter-spacing: -0.02em;
      margin-bottom: 8px;
    }
    .complete h2 .accent { color: var(--accent); }
    .complete p { color: var(--fg-dim); margin-bottom: 24px; }

    .step-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 18px;
    }
    .step-header .back {
      cursor: pointer;
      color: var(--fg-dim);
      font-size: 16px;
      font-weight: 900;
      transition: color .18s ease;
    }
    .step-header .back:hover { color: var(--accent); }
    .step-header h2 {
      font-size: 17px;
      font-weight: 900;
      letter-spacing: -0.01em;
    }

    .hidden { display: none !important; }

    .url-form { display: flex; gap: 12px; }
    .url-form input { flex: 1; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Logo (brand mark from public/aisha.svg) -->
    <div class="logo">
      <div class="mark"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200" fill="none" role="img" aria-label="AISHA"><defs><linearGradient id="ember" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FBBE3C"/><stop offset="0.55" stop-color="#F7931A"/><stop offset="1" stop-color="#E0640A"/></linearGradient></defs><circle cx="600" cy="600" r="600" fill="#0E0E10"/><g transform="translate(0.000000,1200.000000) scale(0.100000,-0.100000)"><path d="M5863 10321 c-428 -116 -618 -618 -372 -986 84 -125 217 -225 347
-261 62 -17 62 -17 62 -135 0 -117 0 -117 -37 -130 -87 -28 -143 -121 -143
-238 0 -56 -2 -61 -22 -62 -13 0 -66 -6 -118 -13 -52 -7 -98 -12 -101 -10 -3
2 -9 52 -13 111 -10 150 -9 150 -152 123 -136 -26 -286 -68 -431 -121 -112
-41 -112 -41 -171 20 -173 177 -440 188 -621 25 -153 -137 -195 -370 -100
-556 21 -41 21 -41 -33 -86 -598 -514 -951 -1204 -1023 -2004 -4 -38 -11 -68
-17 -68 -13 0 -4 349 12 470 27 204 26 209 -26 148 -69 -82 -142 -291 -164
-468 -14 -121 -12 -512 4 -665 16 -149 57 -354 92 -468 32 -98 48 -110 128
-97 73 12 68 16 96 -77 202 -689 772 -1374 1450 -1743 344 -187 667 -294 1083
-357 142 -22 681 -25 822 -5 985 141 1804 687 2285 1521 109 189 220 444 266
609 17 62 17 62 73 55 124 -14 120 -17 170 170 153 576 104 1338 -100 1533
-39 37 -43 28 -30 -64 27 -181 34 -562 11 -562 -4 0 -10 45 -14 101 -34 496
-254 1067 -577 1502 -128 173 -371 425 -472 492 -24 15 -24 15 11 103 118 292
-75 608 -384 629 -142 10 -301 -64 -377 -176 -16 -24 -16 -24 -129 18 -221 81
-502 150 -538 131 -24 -13 -27 -25 -35 -148 -7 -104 -7 -104 -33 -97 -27 7
-175 25 -204 25 -16 0 -18 10 -18 70 0 39 -6 86 -14 104 -20 47 -90 115 -127
123 -39 8 -38 3 -40 133 -1 115 -1 115 74 141 439 154 581 705 270 1049 -157
173 -404 249 -620 191z m288 -181 c336 -103 438 -526 188 -780 -221 -225 -591
-163 -733 121 -184 367 158 779 545 659z m-1666 -1624 c30 -13 105 -88 105
-105 0 -5 -15 -14 -32 -22 -45 -17 -175 -90 -280 -156 -48 -30 -91 -52 -96
-49 -12 7 -32 85 -32 123 0 162 179 274 335 209z m3264 -13 c70 -44 103 -97
108 -180 7 -93 -15 -153 -49 -131 -81 53 -235 142 -300 174 -43 21 -78 42 -78
46 0 5 19 29 41 53 73 79 186 94 278 38z m-1520 -193 c968 -75 1816 -651 2223
-1508 416 -875 314 -1892 -267 -2687 -652 -892 -1814 -1297 -2880 -1003 -1390
383 -2245 1778 -1930 3150 295 1280 1510 2152 2854 2048z M5892 10021 c-139
-48 -248 -214 -177 -269 39 -31 72 -28 104 9 57 69 92 98 138 114 87 32 119
97 70 143 -28 27 -64 27 -135 3z M4960 6790 c-521 -64 -773 -702 -441 -1115
245 -305 711 -331 989 -56 225 223 273 539 124 826 -121 232 -404 378 -672
345z m254 -288 c88 -41 136 -80 179 -145 141 -212 81 -500 -129 -623 -330
-194 -722 92 -643 468 56 261 353 412 593 300z M5015 6266 c-5 -3 -22 -7 -36
-10 -57 -12 -119 -101 -119 -170 0 -177 246 -245 335 -93 48 83 24 191 -53
242 -34 22 -104 39 -127 31z M6832 6789 c-262 -38 -502 -264 -557 -525 -73
-346 107 -676 437 -800 101 -38 313 -42 423 -7 152 48 295 164 378 306 245
421 -16 959 -497 1026 -87 12 -95 12 -184 0z m209 -265 c133 -40 220 -113 278
-234 35 -72 36 -79 36 -185 0 -106 -1 -113 -36 -185 -195 -404 -785 -288 -816
160 -21 291 263 525 538 444z M6872 6257 c-184 -69 -145 -333 51 -345 180 -10
259 216 111 320 -46 33 -114 43 -162 25z M4942 5139 c-78 -39 -113 -139 -78
-222 40 -98 333 -294 566 -380 229 -85 565 -121 803 -88 305 44 594 174 828
374 113 96 127 201 40 288 -74 74 -150 66 -254 -27 -468 -423 -1231 -428
-1674 -11 -98 93 -147 107 -231 66z M3269 7884 c-59 -18 -127 -78 -164 -145
-30 -54 -30 -54 -33 -346 -2 -194 0 -293 7 -293 6 0 31 41 55 91 101 202 240
408 409 606 42 50 77 94 77 97 0 13 -305 4 -351 -10z M8390 7895 c0 -4 25 -35
56 -68 167 -181 335 -427 450 -659 21 -42 41 -75 46 -72 4 3 8 128 8 278 0
319 -5 346 -76 426 -80 88 -101 94 -306 98 -98 2 -178 0 -178 -3z" fill="url(#ember)"/></g></svg></div>
      <div class="eyebrow">AISHA Workbench</div>
      <h1>Připoj se a začni pracovat<span class="accent">.</span></h1>
      <p class="subtitle">Průvodce připojením k backendu</p>
    </div>

    <!-- Step: Mode Select -->
    <div id="step-mode" class="cards">
      <div class="card" data-mode="cloud">
        <div class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18.5a4.5 4.5 0 1 1 .9-8.91A6 6 0 0 1 19.4 11.5a3.5 3.5 0 0 1-.9 7H7z"/></svg></div>
        <div class="text">
          <h3>AISHA Cloud</h3>
          <p>Připojit se k AISHA Cloud</p>
        </div>
        <span class="card-arrow">→</span>
      </div>
      <div class="card" data-mode="local">
        <div class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.2V20h13v-9.8"/><path d="M10 20v-5h4v5"/></svg></div>
        <div class="text">
          <h3>Lokální prostředí</h3>
          <p>Docker + AISHA gateway na tomto stroji</p>
        </div>
        <span class="card-arrow">→</span>
      </div>
      <div class="card" data-mode="custom">
        <div class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="7" x2="20" y2="7"/><circle cx="9.5" cy="7" r="2.2" fill="#0E0E10"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="14.5" cy="17" r="2.2" fill="#0E0E10"/></svg></div>
        <div class="text">
          <h3>Vlastní backend</h3>
          <p>Připojit se k vlastní AISHA gateway instanci</p>
        </div>
        <span class="card-arrow">→</span>
      </div>
    </div>
    <div id="mode-error" class="error" style="display:none;margin-top:12px"></div>

    <!-- Step: Connecting (loading) -->
    <div id="step-connecting" class="hidden">
      <div class="status">
        <div class="spinner"></div>
        <span id="connecting-text">Připojování...</span>
      </div>
    </div>

    <!-- Step: Custom URL -->
    <div id="step-custom" class="hidden">
      <div class="step-header">
        <span class="back" id="back-custom">←</span>
        <h2>Vlastní backend</h2>
      </div>
      <p style="margin-bottom: 12px; font-size: 12px; opacity: .7;">
        Zadej URL svého AISHA backendu (např. https://your-server.com)
      </p>
      <div id="custom-error"></div>
      <div class="url-form">
        <input type="url" id="custom-url" placeholder="https://your-aisha-gateway.example.com" />
        <button class="btn btn-primary" id="custom-connect"><span>Připojit</span></button>
      </div>
    </div>

    <!-- Step: Scan Results (local) -->
    <div id="step-scan" class="hidden">
      <div class="step-header">
        <span class="back" id="back-scan">←</span>
        <h2>Lokální služby</h2>
      </div>
      <div id="services-list" class="services"></div>
      <div id="scan-warning" class="hidden">
        <div class="info">
          Lokální AISHA backend nebyl nalezen. Spusť lokální stack přes Dirigent nebo znovu skenuj po ručním startu.
        </div>
      </div>
      <div id="deploy-status" class="info hidden"></div>
      <div class="btn-row">
        <button class="btn btn-primary hidden" id="scan-continue"><span>Pokračovat →</span></button>
        <button class="btn btn-primary" id="deploy-local-stack" data-testid="deploy-local-stack"><span>Spustit lokální stack</span></button>
        <button class="btn btn-secondary" id="scan-rescan">Znovu skenovat</button>
      </div>
    </div>

    <!-- Step: Auth -->
    <div id="step-auth" class="hidden">
      <div class="step-header">
        <span class="back" id="back-auth">←</span>
        <h2>Přihlášení</h2>
      </div>
      <div id="auth-error"></div>
      <div id="auth-info"></div>
      <div class="auth-form">
        <div class="btn-row">
          <button class="btn btn-primary" id="auth-login"><span>Pokračovat přes AISHA ID</span></button>
          <button class="btn btn-secondary" id="auth-signup">Vytvořit účet v AISHA ID</button>
          <button class="btn btn-secondary" id="auth-skip">Přeskočit</button>
        </div>
      </div>
    </div>

    <!-- Step: Complete -->
    <div id="step-complete" class="hidden">
      <div class="complete">
        <div class="check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 9.5 18 20 6.5"/></svg></div>
        <h2>Připojeno<span class="accent">.</span></h2>
        <p id="complete-info">Vše je nastaveno.</p>
        <button class="btn btn-primary" id="open-dashboard" style="padding: 12px 28px; font-size: 14px;">
          <span>Otevřít Dashboard →</span>
        </button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // Elements
    const steps = {
      mode: document.getElementById('step-mode'),
      connecting: document.getElementById('step-connecting'),
      custom: document.getElementById('step-custom'),
      scan: document.getElementById('step-scan'),
      auth: document.getElementById('step-auth'),
      complete: document.getElementById('step-complete'),
    };

    function showStep(name) {
      Object.values(steps).forEach(el => el.classList.add('hidden'));
      if (steps[name]) steps[name].classList.remove('hidden');
    }

    // Mode cards
    document.querySelectorAll('.card[data-mode]').forEach(card => {
      card.addEventListener('click', () => {
        const mode = card.dataset.mode;
        showStep('connecting');
        vscode.postMessage({ type: 'selectMode', mode });
      });
    });

    // Custom URL
    document.getElementById('custom-connect').addEventListener('click', () => {
      const url = document.getElementById('custom-url').value.trim();
      if (!url) return;
      showStep('connecting');
      vscode.postMessage({ type: 'customConnect', url });
    });
    document.getElementById('custom-url').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('custom-connect').click();
    });

    // Auth
    document.getElementById('auth-login').addEventListener('click', () => {
      submitAuth('login');
    });
    document.getElementById('auth-signup').addEventListener('click', () => {
      submitAuth('signup');
    });
    document.getElementById('auth-skip').addEventListener('click', () => {
      vscode.postMessage({ type: 'skipAuth' });
    });

    function submitAuth(action) {
      showStep('connecting');
      document.getElementById('connecting-text').textContent = 'Ověřování...';
      vscode.postMessage({ type: 'auth', action, email: '', password: '' });
    }

    // Back buttons
    document.getElementById('back-custom').addEventListener('click', () => showStep('mode'));
    document.getElementById('back-scan').addEventListener('click', () => showStep('mode'));
    document.getElementById('back-auth').addEventListener('click', () => showStep('mode'));

    // Scan buttons
    document.getElementById('scan-rescan').addEventListener('click', () => {
      showStep('connecting');
      document.getElementById('connecting-text').textContent = 'Skenování služeb...';
      vscode.postMessage({ type: 'selectMode', mode: 'local' });
    });
    document.getElementById('deploy-local-stack')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'deployLocalStack' });
    });
    document.getElementById('scan-continue')?.addEventListener('click', () => {
      showStep('auth');
    });

    // Complete
    document.getElementById('open-dashboard').addEventListener('click', () => {
      vscode.postMessage({ type: 'openDashboard' });
    });

    // Messages from extension
    window.addEventListener('message', (e) => {
      const msg = e.data;
      switch (msg.type) {
        case 'stepChanged':
          if (msg.step === 'auth') showStep('auth');
          else if (msg.step === 'custom-url') showStep('custom');
          else if (msg.step === 'scan-results') showStep('scan');
          break;

        case 'status':
          document.getElementById('connecting-text').textContent = msg.text;
          break;

        case 'error':
          showStep('mode');
          {
            const el = document.getElementById('mode-error');
            if (el) {
              el.textContent = msg.text || 'Setup failed. Try again.';
              el.style.display = 'block';
            }
          }
          break;

        case 'scanResults':
          renderServices(msg.services, msg.hasBackend);
          break;

        case 'authError':
          showStep('auth');
          document.getElementById('auth-error').innerHTML =
            '<div class="error">' + escapeHtml(msg.text) + '</div>';
          break;

        case 'authInfo':
          showStep('auth');
          document.getElementById('auth-info').innerHTML =
            '<div class="info">' + escapeHtml(msg.text) + '</div>';
          break;

        case 'deployStarted':
        case 'deployTimedOut':
          {
            const el = document.getElementById('deploy-status');
            if (el) {
              el.textContent = msg.text || '';
              el.classList.remove('hidden');
            }
          }
          break;

        case 'setupComplete':
          showStep('complete');
          const info = msg.email
            ? 'Přihlášen jako ' + escapeHtml(msg.email)
            : 'Připojeno k ' + escapeHtml(msg.connectionLabel);
          document.getElementById('complete-info').textContent = info;
          break;
      }
    });

    function renderServices(services, hasBackend) {
      const list = document.getElementById('services-list');
      list.innerHTML = services.map(s =>
        '<div class="service">' +
          '<span class="dot ' + (s.detected ? 'on' : 'off') + '"></span>' +
          '<span>' + escapeHtml(s.name) + '</span>' +
          (s.version ? '<span style="opacity:.5; margin-left:auto;">' + escapeHtml(s.version) + '</span>' : '') +
        '</div>'
      ).join('');

      if (hasBackend) {
        document.getElementById('scan-continue').classList.remove('hidden');
        document.getElementById('scan-warning').classList.add('hidden');
      } else {
        document.getElementById('scan-continue').classList.add('hidden');
        document.getElementById('scan-warning').classList.remove('hidden');
      }
    }

    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }
  </script>
</body>
</html>`;
  }
}
