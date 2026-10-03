/**
 * Generate all IDE instruction files from a payload.
 *
 * Orchestrates all bundled adapters and writes output via vscode.workspace.fs.
 * Replaces the external dependency on `npm run gen:ide`.
 *
 * @module
 */

import * as vscode from "vscode";
import { stripVolatile } from "./registry";
import { safeWrite } from "./file-safety";
import { adapterCopilot } from "./adapter-copilot";
import { adapterAgents } from "./adapter-agents";
import { adapterClaude } from "./adapter-claude";
import { adapterCursorrules } from "./adapter-cursorrules";
import { adapterWindsurfrules } from "./adapter-windsurfrules";
import { adapterZedrules } from "./adapter-zedrules";
import { adapterAishaAgent } from "./adapter-aisha-agent";
import { adapterCodexSkill } from "./adapter-codex-skill";
import { adapterClaudeOverlay } from "./adapter-claude-overlay";
import { isMultiFileOutput } from "./multi-file";
import { writeMultiFile } from "./multi-file-writer";
import { fetchClaudeHookBindings } from "./fetch-bindings";

import type { IdeAdapter, InstructionPayload } from "./registry";

const ALL_ADAPTERS: IdeAdapter[] = [
  adapterCopilot,
  adapterAgents,
  adapterClaude,
  adapterCursorrules,
  adapterWindsurfrules,
  adapterZedrules,
  adapterAishaAgent,
  adapterCodexSkill,
  adapterClaudeOverlay,
];

export interface GenerateResult {
  written: string[];
  skipped: string[];
  refused: string[];
  errors: Array<{ adapter: string; error: string }>;
  preservedUserSections: string[];
  backups: string[];
}

/**
 * Generate all IDE instruction files and write them to the workspace.
 *
 * Safety contract enforced via `safeWrite`:
 *  - files without the AISHA auto-gen header are NEVER overwritten (`refused`)
 *  - user-section blocks survive every regeneration
 *  - every overwrite leaves a timestamped backup under `.aisha/backups/`
 *
 * Multi-file adapters (e.g. adapter-claude-overlay) return MultiFileOutput
 * instead of a single string — the orchestrator iterates their files[] and
 * applies per-file mode/merge semantics. Executable shell scripts bypass
 * safeWrite's user-section injection (HTML markers would be noise in .sh).
 */
export async function generateAll(
  payload: InstructionPayload,
  rootUri: vscode.Uri,
): Promise<GenerateResult> {
  const result: GenerateResult = {
    written: [],
    skipped: [],
    refused: [],
    errors: [],
    preservedUserSections: [],
    backups: [],
  };

  // Best-effort: pre-fetch live rule bindings via RPC so adapters that need
  // them (today: adapter-claude-overlay) use cloud-current data instead of the
  // bundled JSON mirror. Failure is silent — adapter falls back to its
  // bundled mirror, which is byte-checked vs the SQL seed by the
  // claude-overlay-drift gate test. This keeps the overlay functional in
  // cold-start, offline, and unauthenticated modes.
  const storyId = (payload as { story?: { id?: string | null } | null }).story?.id ?? null;
  const liveBindings = await fetchClaudeHookBindings(storyId).catch(() => null);
  const enrichedPayload =
    liveBindings && liveBindings.length > 0
      ? { ...payload, claude_hook_bindings: liveBindings }
      : payload;

  for (const adapter of ALL_ADAPTERS) {
    try {
      const content = await adapter.generate(enrichedPayload);

      if (isMultiFileOutput(content)) {
        await writeMultiFile(content, adapter.meta.id, rootUri, result);
        continue;
      }

      const outputPath = adapter.meta.outputPath;
      const fileUri = vscode.Uri.joinPath(rootUri, outputPath);
      let existingContent: string | null = null;
      try {
        const existing = await vscode.workspace.fs.readFile(fileUri);
        existingContent = new TextDecoder().decode(existing);
      } catch {
        // file doesn't exist yet
      }

      if (
        existingContent !== null &&
        stripVolatile(existingContent) === stripVolatile(content as string)
      ) {
        result.skipped.push(outputPath);
        continue;
      }

      const outcome = await safeWrite(rootUri, outputPath, content as string, existingContent);
      switch (outcome.outcome) {
        case "written":
          result.written.push(outputPath);
          if (outcome.preservedUserSection) result.preservedUserSections.push(outputPath);
          if (outcome.backupPath) result.backups.push(outcome.backupPath);
          break;
        case "skipped-identical":
          result.skipped.push(outputPath);
          break;
        case "refused-user-owned":
          result.refused.push(outputPath);
          break;
        case "backup-failed":
          result.errors.push({ adapter: adapter.meta.id, error: "backup-failed (write aborted)" });
          break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ adapter: adapter.meta.id, error: msg });
    }
  }

  return result;
}

/** Get the list of all registered adapter output paths. */
export function getAdapterOutputPaths(): string[] {
  return ALL_ADAPTERS.flatMap((a) => (a.meta.outputPath === "<multi>" ? [] : [a.meta.outputPath]));
}

// writeMultiFile implementation moved to ./multi-file-writer.ts so this file
// (generate-all.ts) contains ONLY safeWrite calls — required by
// src/tests/gates/ide-instructions-safety.gate.test.ts
// "generate-all.ts writes only via safeWrite" invariant.
