/**
 * Workbench Context Detection — determines the runtime environment.
 *
 * Detects whether the extension runs inside AISHA Workbench (custom VSCodium build)
 * and whether the current workspace is the AISHA monorepo (local dev stack available).
 *
 * @module
 */

import * as vscode from "vscode";

/**
 * Check if running inside AISHA Workbench (custom VSCodium build).
 *
 * Detection is based on `vscode.env.appName` which is set by
 * product.json `nameShort` during the workbench build.
 */
export function isAishaWorkbench(): boolean {
  return vscode.env.appName === "AISHA Workbench";
}

/**
 * Check if the current workspace is the AISHA monorepo.
 *
 * Looks for the combination of `docker-compose.local.yml` and
 * `extensions/aisha-dirigent/` — both unique to the monorepo.
 * When detected, env vars from `.env` provide the local dev config.
 */
export async function isAishaMonorepo(): Promise<boolean> {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) return false;

  try {
    await vscode.workspace.fs.stat(
      vscode.Uri.joinPath(root.uri, "docker-compose.local.yml"),
    );
    await vscode.workspace.fs.stat(
      vscode.Uri.joinPath(root.uri, "extensions", "aisha-dirigent"),
    );
    return true;
  } catch {
    return false;
  }
}
