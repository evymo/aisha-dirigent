/**
 * GitHub App integration module for AISHA Dirigent extension.
 *
 * Provides:
 * - `/connect-repo` chat command — link workspace to GitHub App installation
 * - Auto-detect: workspace git remote → match known installations → auto-link
 * - Story context enrichment with GitHub repo info
 * - Status bar GitHub connection indicator
 *
 * @module
 */

import * as vscode from "vscode";
import { execSync } from "child_process";
import { recordChildProcess } from "./resource-tracker";
import { callMcpTool, extractJson, extractMarkdown } from "./mcp-client";
import { resolveStoryContext } from "./story-context";
import { getDirigentConfig } from "./config";

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

/** GitHub App installation info from backend */
interface GitHubInstallation {
  installation_id: number;
  account_login: string;
  account_type: string;
  partner_id: string | null;
  repository_selection: string;
  suspended_at: string | null;
}

/** GitHub repository linked to an installation */
interface GitHubRepository {
  full_name: string;
  default_branch: string;
  is_private: boolean;
  installation_id: number;
}

/** Git remote parsed from workspace .git/config */
interface GitRemote {
  name: string;
  owner: string;
  repo: string;
  url: string;
}

// ──────────────────────────────────────────
// Git remote detection
// ──────────────────────────────────────────

/**
 * Parse git remotes from workspace.
 * Extracts owner/repo from GitHub URLs (SSH and HTTPS).
 */
function detectGitRemotes(): GitRemote[] {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return [];

  try {
    const output = execSync("git remote -v", {
      cwd: root,
      encoding: "utf-8",
      timeout: 5000,
    });
    recordChildProcess();

    const remotes: GitRemote[] = [];
    const seen = new Set<string>();

    for (const line of output.split("\n")) {
      // Match: origin	git@github.com:owner/repo.git (fetch)
      // Match: origin	https://github.com/owner/repo.git (fetch)
      const match = line.match(
        /^(\S+)\s+(?:git@github\.com:|https?:\/\/github\.com\/)([^/]+)\/([^/\s]+?)(?:\.git)?\s+\(fetch\)/,
      );
      if (match) {
        const key = `${match[2]}/${match[3]}`;
        if (!seen.has(key)) {
          seen.add(key);
          remotes.push({
            name: match[1],
            owner: match[2],
            repo: match[3],
            url: line.split(/\s+/)[1],
          });
        }
      }
    }

    return remotes;
  } catch {
    return [];
  }
}

// ──────────────────────────────────────────
// /connect-repo command handler
// ──────────────────────────────────────────

/**
 * `/connect-repo` — Link workspace to a GitHub App installation.
 *
 * Flow:
 * 1. Detect workspace git remotes
 * 2. Fetch known installations from backend
 * 3. Auto-match or let user pick
 * 4. Link story to installation + repo
 */
export async function handleConnectRepo(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  _token: vscode.CancellationToken,
): Promise<void> {
  const story = await resolveStoryContext();

  if (!story.storyId) {
    stream.markdown(
      vscode.l10n.t("No active story. Set a story first with **AISHA: Set Active Story** command.") +
      "\n\n" +
      vscode.l10n.t("The `/connect-repo` command links a GitHub repository to your active story."),
    );
    return;
  }

  stream.progress(vscode.l10n.t("Detecting workspace git remotes…"));

  // Step 1: Detect local git remotes
  const remotes = detectGitRemotes();

  // Step 2: Fetch installations from backend
  stream.progress(vscode.l10n.t("Fetching GitHub App installations…"));
  const installationsResult = await callMcpTool("github_repo", {
    operation: "list_installations",
  });

  if (!installationsResult || installationsResult.isError) {
    stream.markdown(
      "**Error:** " +
      vscode.l10n.t("Could not fetch GitHub App installations. Check MCP connection and ensure the GitHub App is installed."),
    );
    return;
  }

  const installationsJson = extractJson(installationsResult);
  const installations = (installationsJson?.installations ?? []) as GitHubInstallation[];

  if (!installations.length) {
    stream.markdown(
      "### " + vscode.l10n.t("No GitHub App Installations Found") + "\n\n" +
      vscode.l10n.t("Install the AISHA Dirigent GitHub App on your organization:") + "\n\n" +
      "1. " + vscode.l10n.t("Go to your GitHub organization settings") + "\n" +
      "2. " + vscode.l10n.t("Developer settings → GitHub Apps → Install") + "\n" +
      "3. " + vscode.l10n.t("Select repositories and confirm") + "\n\n" +
      vscode.l10n.t("After installation, run `/connect-repo` again."),
    );
    return;
  }

  // Step 3: Auto-match remote to installation
  let matchedInstallation: GitHubInstallation | undefined;
  let matchedRemote: GitRemote | undefined;

  if (remotes.length) {
    for (const remote of remotes) {
      const match = installations.find(
        (inst) => inst.account_login.toLowerCase() === remote.owner.toLowerCase(),
      );
      if (match) {
        matchedInstallation = match;
        matchedRemote = remote;
        break;
      }
    }
  }

  // Build result markdown
  const lines: string[] = [];

  if (matchedInstallation && matchedRemote) {
    lines.push(
      "### " + vscode.l10n.t("Auto-detected GitHub Connection") + "\n",
      `- **${vscode.l10n.t("Remote")}:** \`${matchedRemote.name}\` → \`${matchedRemote.owner}/${matchedRemote.repo}\``,
      `- **${vscode.l10n.t("Installation")}:** ${matchedInstallation.account_login} (${matchedInstallation.account_type})`,
      `- **${vscode.l10n.t("Installation ID")}:** ${matchedInstallation.installation_id}`,
      "",
    );

    // Link story to repo
    stream.progress(vscode.l10n.t("Linking story to repository…"));
    const linkResult = await callMcpTool("github_repo", {
      operation: "link_story_to_repo",
      story_id: story.storyId,
      installation_id: matchedInstallation.installation_id,
      repo_full_name: `${matchedRemote.owner}/${matchedRemote.repo}`,
    });

    if (linkResult && !linkResult.isError) {
      lines.push(
        vscode.l10n.t("Story linked to repository.") + "\n",
        vscode.l10n.t("AISHA can now manage PRs, branches, and deployments for this repository."),
      );
    } else {
      lines.push(
        "**Warning:** " + vscode.l10n.t("Could not link story to repository automatically.") + "\n",
        extractMarkdown(linkResult) || "",
      );
    }
  } else {
    // No auto-match — show available installations
    lines.push(
      "### " + vscode.l10n.t("GitHub App Installations") + "\n",
      "| " + vscode.l10n.t("Organization") + " | " + vscode.l10n.t("Type") + " | " + vscode.l10n.t("Selection") + " | " + vscode.l10n.t("Status") + " |",
      "|---|---|---|---|",
    );

    for (const inst of installations) {
      const status = inst.suspended_at ? "Suspended" : "Active";
      lines.push(`| ${inst.account_login} | ${inst.account_type} | ${inst.repository_selection} | ${status} |`);
    }

    lines.push("");

    if (remotes.length) {
      lines.push(
        vscode.l10n.t("Detected git remotes: {0}", remotes.map((r) => `\`${r.owner}/${r.repo}\``).join(", ")) + "\n",
        vscode.l10n.t("No matching installation found. Install the GitHub App on the repository organization."),
      );
    } else {
      lines.push(
        vscode.l10n.t("No git remote detected in this workspace. Initialize a git repository first."),
      );
    }
  }

  stream.markdown(lines.join("\n"));
}

// ──────────────────────────────────────────
// Story context enrichment
// ──────────────────────────────────────────

/** GitHub context for current story */
export interface GitHubStoryContext {
  connected: boolean;
  installationId: number | null;
  accountLogin: string | null;
  repoFullName: string | null;
  defaultBranch: string | null;
}

/**
 * Resolve GitHub context for current story.
 * Returns connection status and repo info (if linked).
 */
export async function resolveGitHubContext(): Promise<GitHubStoryContext> {
  const empty: GitHubStoryContext = {
    connected: false,
    installationId: null,
    accountLogin: null,
    repoFullName: null,
    defaultBranch: null,
  };

  const story = await resolveStoryContext();
  if (!story.storyId) return empty;

  try {
    const result = await callMcpTool("get_integration_health", {
      story_id: story.storyId,
    });

    if (!result || result.isError) return empty;

    const json = extractJson(result);
    if (!json?.connected) return empty;

    return {
      connected: true,
      installationId: (json.installation_id as number) ?? null,
      accountLogin: (json.account_login as string) ?? null,
      repoFullName: (json.repo_full_name as string) ?? null,
      defaultBranch: (json.default_branch as string) ?? null,
    };
  } catch {
    return empty;
  }
}

// ──────────────────────────────────────────
// Auto-detect workspace → installation match
// ──────────────────────────────────────────

/**
 * Try to auto-detect if workspace git remote matches a known GitHub App installation.
 * Shows a notification offering to link story if match found.
 * Called once on extension activation.
 */
export async function autoDetectGitHubConnection(
  context: vscode.ExtensionContext,
): Promise<void> {
  const story = await resolveStoryContext();
  if (!story.storyId) return;

  const config = getDirigentConfig();
  if (!config.mcpUrl) return;

  // Skip if already linked (check via integration health)
  const existingCtx = await resolveGitHubContext();
  if (existingCtx.connected) return;

  const remotes = detectGitRemotes();
  if (!remotes.length) return;

  // Check if any remote matches a known installation
  const result = await callMcpTool("github_repo", {
    operation: "list_installations",
  });

  if (!result || result.isError) return;

  const json = extractJson(result);
  const installations = (json?.installations ?? []) as GitHubInstallation[];

  for (const remote of remotes) {
    const match = installations.find(
      (inst) => inst.account_login.toLowerCase() === remote.owner.toLowerCase(),
    );
    if (match) {
      const connect = vscode.l10n.t("Connect");
      const later = vscode.l10n.t("Later");
      const choice = await vscode.window.showInformationMessage(
        vscode.l10n.t(
          "AISHA: GitHub App detected for {0}/{1}. Link to active story?",
          remote.owner,
          remote.repo,
        ),
        connect,
        later,
      );

      if (choice === connect) {
        const linkResult = await callMcpTool("github_repo", {
          operation: "link_story_to_repo",
          story_id: story.storyId,
          installation_id: match.installation_id,
          repo_full_name: `${remote.owner}/${remote.repo}`,
        });

        if (linkResult && !linkResult.isError) {
          void vscode.window.showInformationMessage(
            vscode.l10n.t("AISHA: Story linked to {0}/{1}", remote.owner, remote.repo),
          );
        }
      }
      break; // Only offer once
    }
  }
}

// ──────────────────────────────────────────
// Status bar integration
// ──────────────────────────────────────────

/**
 * Create a status bar item showing GitHub App connection status.
 * Returns a disposable that manages the status bar item lifecycle.
 */
export function createGitHubStatusBarItem(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    90,
  );
  item.command = "aisha.dirigent.connectRepo";
  item.tooltip = vscode.l10n.t("AISHA GitHub App — click to connect");
  item.text = "$(mark-github) —";
  item.show();

  // Initial refresh
  void refreshGitHubStatus(item);

  return item;
}

/**
 * Refresh GitHub connection status in the status bar.
 */
export async function refreshGitHubStatus(
  item: vscode.StatusBarItem,
): Promise<void> {
  const ctx = await resolveGitHubContext();

  if (ctx.connected && ctx.repoFullName) {
    item.text = `$(mark-github) ${ctx.repoFullName}`;
    item.tooltip = vscode.l10n.t(
      "AISHA GitHub App: Connected to {0} (branch: {1})",
      ctx.repoFullName,
      ctx.defaultBranch ?? "main",
    );
    item.backgroundColor = undefined;
  } else if (ctx.connected) {
    item.text = `$(mark-github) ${ctx.accountLogin ?? "connected"}`;
    item.tooltip = vscode.l10n.t("AISHA GitHub App: Connected");
    item.backgroundColor = undefined;
  } else {
    item.text = "$(mark-github) —";
    item.tooltip = vscode.l10n.t("AISHA GitHub App — click to connect");
    item.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground",
    );
  }
}
