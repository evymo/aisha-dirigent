/**
 * Warmup Environment Detector — probes local services for the walkthrough.
 *
 * Unlike compute-tier.ts (which detects LLM endpoints),
 * this module scans for infrastructure: AISHA gateway, Keycloak, Docker, n8n,
 * Ollama, LM Studio, Langfuse, and reports readiness for each warmup step.
 *
 * Results feed into walkthrough completionEvents and context keys.
 *
 * @module
 */

import * as vscode from "vscode";

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

export interface ServiceProbe {
  name: string;
  detected: boolean;
  version?: string;
  url?: string;
}

export interface WarmupEnvironment {
  /** Timestamp of last scan */
  scannedAt: number;
  /** Individual service results */
  services: ServiceProbe[];
  /** Is any backend reachable? */
  hasBackend: boolean;
  /** Is any AI model available? */
  hasAiModel: boolean;
  /** Does .aisha/ config exist? */
  hasConfig: boolean;
  /** Is user authenticated? */
  isAuthenticated: boolean;
}

// ──────────────────────────────────────────
// Port probes
// ──────────────────────────────────────────

const SERVICE_PROBES = [
  { name: "AISHA Gateway", port: 57421, path: "/health", checkField: null },
  { name: "PostgREST RPC", port: 57421, path: "/rest/v1/", checkField: null },
  { name: "Keycloak", port: 8080, path: `/realms/${process.env.KEYCLOAK_REALM ?? "aisha"}/.well-known/openid-configuration`, checkField: "issuer" },
  { name: "Docker Desktop", port: 2375, path: "/version", checkField: "Version" },
  { name: "Ollama", port: 11434, path: "/api/tags", checkField: "models" },
  { name: "LM Studio", port: 1234, path: "/v1/models", checkField: "data" },
  { name: "n8n", port: 5678, path: "/healthz", checkField: null },
  { name: "Langfuse", port: 3000, path: "/api/public/health", checkField: null },
] as const;

async function probePort(
  host: string,
  port: number,
  path: string,
  checkField: string | null,
): Promise<{ ok: boolean; version?: string }> {
  try {
    const url = `http://${host}:${port}${path}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(2_000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { ok: false };

    if (checkField) {
      const raw: unknown = await res.json();
      if (typeof raw !== "object" || raw === null) return { ok: false };
      const json = raw as Record<string, unknown>;
      const hasField = checkField in json;
      const version = typeof json["Version"] === "string" ? json["Version"] : undefined;
      return { ok: hasField, version };
    }

    return { ok: true };
  } catch {
    return { ok: false };
  }
}

// ──────────────────────────────────────────
// Main scanner
// ──────────────────────────────────────────

let _cachedResult: WarmupEnvironment | null = null;

const _onScanComplete = new vscode.EventEmitter<WarmupEnvironment>();
/** Fires when environment scan completes. */
export const onWarmupScanComplete: vscode.Event<WarmupEnvironment> = _onScanComplete.event;

/**
 * Run a full environment scan.
 * Results are cached until next explicit scan.
 */
export async function scanEnvironment(): Promise<WarmupEnvironment> {
  const host = "127.0.0.1";

  // Probe all services in parallel
  const probeResults = await Promise.all(
    SERVICE_PROBES.map(async (svc) => {
      const result = await probePort(host, svc.port, svc.path, svc.checkField);
      return {
        name: svc.name,
        detected: result.ok,
        version: result.version,
        url: result.ok ? `http://${host}:${svc.port}` : undefined,
      } satisfies ServiceProbe;
    }),
  );

  // Check .aisha/ config
  let hasConfig = false;
  const wsRoot = vscode.workspace.workspaceFolders?.[0];
  if (wsRoot) {
    try {
      await vscode.workspace.fs.stat(
        vscode.Uri.joinPath(wsRoot.uri, ".aisha", "dirigent.json"),
      );
      hasConfig = true;
    } catch {
      // not found
    }
  }

  const hasBackend = probeResults.some(
    (s) => (s.name === "AISHA Gateway" || s.name === "PostgREST RPC") && s.detected,
  );
  const hasAiModel = probeResults.some(
    (s) => (s.name === "Ollama" || s.name === "LM Studio") && s.detected,
  );

  const env: WarmupEnvironment = {
    scannedAt: Date.now(),
    services: probeResults,
    hasBackend,
    hasAiModel,
    hasConfig,
    isAuthenticated: false, // Caller should set this from auth module
  };

  _cachedResult = env;
  _onScanComplete.fire(env);

  // Set VS Code context keys for walkthrough completionEvents
  void vscode.commands.executeCommand(
    "setContext",
    "aisha.warmup.hasBackend",
    hasBackend,
  );
  void vscode.commands.executeCommand(
    "setContext",
    "aisha.warmup.hasAiModel",
    hasAiModel,
  );
  void vscode.commands.executeCommand(
    "setContext",
    "aisha.warmup.hasConfig",
    hasConfig,
  );
  void vscode.commands.executeCommand(
    "setContext",
    "aisha.warmup.scanned",
    true,
  );

  return env;
}

/**
 * Get cached scan result, or run fresh scan if none.
 */
export async function getWarmupEnvironment(): Promise<WarmupEnvironment> {
  if (_cachedResult && (Date.now() - _cachedResult.scannedAt) < 60_000) {
    return _cachedResult;
  }
  return scanEnvironment();
}

/**
 * Format scan results for display (used by walkthrough step description).
 */
export function formatScanSummary(env: WarmupEnvironment): string {
  const detected = env.services.filter((s) => s.detected);
  if (detected.length === 0) {
    return "Nebyly nalezeny žádné lokální služby.";
  }
  const names = detected.map((s) => s.version ? `${s.name} (${s.version})` : s.name);
  return `Nalezeno: ${names.join(", ")}`;
}
