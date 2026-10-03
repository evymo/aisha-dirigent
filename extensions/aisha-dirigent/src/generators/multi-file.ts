/**
 * Multi-file adapter output types and JSON merge helper, shared between CLI
 * (scripts/ide-adapters/multi-file.mjs) and extension generators.
 *
 * Keep semantics in sync with the .mjs sibling — gate test
 * `claude-overlay-drift.gate.test.ts` regenerates from CLI and compares
 * against the committed snapshot. Divergence between CLI and extension here
 * would cause silent drift.
 * @module
 */

export interface GeneratedFile {
  /** Repo-root-relative path, e.g. ".claude/hooks/aisha-advise-rpc.sh" */
  path: string;
  content: string;
  /** chmod 0o755 after write (shell scripts) */
  mode?: "executable";
  /** Combine strategy with existing on-disk content. */
  merge?: "replace" | "merge-json-keys";
}

export interface MultiFileOutput {
  files: GeneratedFile[];
}

export function isMultiFileOutput(value: unknown): value is MultiFileOutput {
  if (typeof value !== "object" || value === null) return false;
  const cast = value as { files?: unknown };
  if (!Array.isArray(cast.files)) return false;
  return cast.files.every(
    (f) =>
      typeof f === "object" &&
      f !== null &&
      typeof (f as GeneratedFile).path === "string" &&
      typeof (f as GeneratedFile).content === "string",
  );
}

/**
 * Mirror of scripts/ide-adapters/multi-file.mjs::mergeSettingsJson.
 * Preserves user-added hook entries; replaces entries marked `_aisha.managed: true`.
 */
export function mergeSettingsJson(existingJson: string, generatedJson: string): string {
  type Hook = { _aisha?: { managed?: boolean } } & Record<string, unknown>;
  type HookEntry = { matcher?: string; hooks?: Hook[] };
  type SettingsLike = {
    permissions?: { allow?: string[]; deny?: string[] };
    hooks?: Record<string, HookEntry[]>;
    statusLine?: { _aisha?: { managed?: boolean } } & Record<string, unknown>;
    _aisha_managed?: unknown;
    [key: string]: unknown;
  };

  let existing: SettingsLike;
  let generated: SettingsLike;
  try {
    existing = existingJson.trim() ? (JSON.parse(existingJson) as SettingsLike) : {};
  } catch (e) {
    throw new Error(`mergeSettingsJson: existing JSON invalid: ${(e as Error).message}`);
  }
  try {
    generated = JSON.parse(generatedJson) as SettingsLike;
  } catch (e) {
    throw new Error(`mergeSettingsJson: generated JSON invalid: ${(e as Error).message}`);
  }

  const merged: SettingsLike = { ...existing };

  if (generated.permissions) {
    merged.permissions = merged.permissions ?? {};
    for (const key of ["allow", "deny"] as const) {
      const e = Array.isArray(merged.permissions[key]) ? merged.permissions[key]! : [];
      const g = Array.isArray(generated.permissions[key]) ? generated.permissions[key]! : [];
      merged.permissions[key] = [...new Set([...e, ...g])];
    }
  }

  if (generated.hooks) {
    merged.hooks = merged.hooks ?? {};
    for (const ev of Object.keys(generated.hooks)) {
      const existingEv = Array.isArray(merged.hooks[ev]) ? merged.hooks[ev] : [];
      const generatedEv = Array.isArray(generated.hooks[ev]) ? generated.hooks[ev] : [];
      merged.hooks[ev] = mergeHookEvent(existingEv, generatedEv) as HookEntry[];
    }
  }

  if (generated.statusLine) {
    if (generated.statusLine._aisha?.managed === true || !merged.statusLine) {
      merged.statusLine = generated.statusLine;
    }
  }

  if (generated._aisha_managed) {
    merged._aisha_managed = generated._aisha_managed;
  }

  return JSON.stringify(merged, null, 2) + "\n";
}

/**
 * Mirror of scripts/lib/mcp-json-merge.mjs::mergeMcpJson.
 *
 * Upserts a single managed MCP server entry into `.mcp.json` WITHOUT discarding
 * any other `mcpServers` entries the user added by hand, and without dropping
 * unrelated top-level keys. Empty / malformed input is treated as `{}` — the
 * file is NEVER thrown away on a parse failure.
 *
 * @param existingText Current `.mcp.json` content (or "" if missing).
 * @param name         Server key to upsert under `mcpServers`.
 * @param server       Server definition (e.g. { type, url } or { command, args }).
 * @returns Merged JSON serialized with 2-space indent + trailing newline.
 */
export function mergeMcpJson(
  existingText: string,
  name: string,
  server: Record<string, unknown>,
): string {
  type McpLike = { mcpServers?: Record<string, unknown> } & Record<string, unknown>;

  let existing: McpLike;
  try {
    existing = existingText && existingText.trim() ? (JSON.parse(existingText) as McpLike) : {};
  } catch {
    // Never discard the file on a parse error — treat as empty and re-seed.
    existing = {};
  }
  if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
    existing = {};
  }

  const merged: McpLike = { ...existing };
  const existingServers =
    typeof merged.mcpServers === "object" &&
    merged.mcpServers !== null &&
    !Array.isArray(merged.mcpServers)
      ? merged.mcpServers
      : {};
  merged.mcpServers = { ...existingServers, [name]: server };

  return JSON.stringify(merged, null, 2) + "\n";
}

function mergeHookEvent(
  existingEv: Array<{ matcher?: string; hooks?: Array<{ _aisha?: { managed?: boolean } }> }>,
  generatedEv: Array<{ matcher?: string; hooks?: Array<unknown> }>,
): Array<{ matcher?: string; hooks: unknown[] }> {
  const byMatcher = new Map<
    string,
    { existing: Array<{ _aisha?: { managed?: boolean } }>; generated: unknown[] }
  >();

  for (const entry of existingEv) {
    const m = entry.matcher ?? "";
    if (!byMatcher.has(m)) byMatcher.set(m, { existing: [], generated: [] });
    byMatcher.get(m)!.existing = Array.isArray(entry.hooks) ? entry.hooks : [];
  }
  for (const entry of generatedEv) {
    const m = entry.matcher ?? "";
    if (!byMatcher.has(m)) byMatcher.set(m, { existing: [], generated: [] });
    byMatcher.get(m)!.generated = Array.isArray(entry.hooks) ? entry.hooks : [];
  }

  const out: Array<{ matcher?: string; hooks: unknown[] }> = [];
  for (const [m, { existing, generated }] of byMatcher) {
    const existingKept = existing.filter((h) => h?._aisha?.managed !== true);
    const combined = [...existingKept, ...generated];
    if (combined.length > 0) {
      out.push(m ? { matcher: m, hooks: combined } : { hooks: combined });
    }
  }
  return out;
}
