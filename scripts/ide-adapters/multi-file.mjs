/**
 * @module multi-file
 * Helpers for adapters that emit more than one file (e.g. adapter-claude-overlay
 * which writes 7+ hook scripts + subagent + skill + settings.json patch).
 *
 * The base adapter contract (`generate(payload) → string` + `meta.outputPath`)
 * is unchanged for single-file adapters. Multi-file adapters return a structured
 * value matching `MultiFileOutput` below.
 */

/**
 * @typedef {object} GeneratedFile
 * @property {string}  path      Relative path from repo root, e.g. ".claude/hooks/aisha-advise-rpc.sh".
 * @property {string}  content   File content.
 * @property {"executable"=} mode  If "executable", chmod 0o755 after write (shell scripts).
 * @property {"replace"|"merge-json-keys"=} merge  How to combine with existing on disk.
 *   - "replace" (default): full overwrite (with safeWriteSync user-section protection).
 *   - "merge-json-keys": deep-merge JSON, replacing only managed entries (settings.json).
 * @property {string=} mergeMarker  When merge="merge-json-keys", entries with this
 *   marker key are owned by the adapter; everything else is preserved.
 *   Default marker: "_aisha.managed: true".
 */

/**
 * @typedef {object} MultiFileOutput
 * @property {GeneratedFile[]} files  One entry per emitted file.
 */

/**
 * Type guard: does the adapter result look like a multi-file output?
 * @param {unknown} value
 * @returns {value is MultiFileOutput}
 */
export function isMultiFileOutput(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray(/** @type {{ files?: unknown }} */ (value).files) &&
    /** @type {{ files: unknown[] }} */ (value).files.every(
      (f) =>
        typeof f === "object" &&
        f !== null &&
        typeof (/** @type {{ path?: unknown }} */ (f)).path === "string" &&
        typeof (/** @type {{ content?: unknown }} */ (f)).content === "string",
    )
  );
}

/**
 * Deep merge a generated JSON content into existing JSON on disk, preserving
 * non-managed entries.
 *
 * Currently scoped to `.claude/settings.json`-style structures:
 *   - `permissions.allow` / `permissions.deny`: union of arrays (de-duped)
 *   - `hooks.<event>[*].hooks[*]`: replace entries with `_aisha.managed === true`,
 *     keep everything else
 *   - `statusLine`: if generated has `_aisha.managed === true`, replace; else keep
 *   - top-level `_aisha_managed` metadata block: full replace
 *   - any other top-level key: prefer generated if generated has it, else existing
 *
 * The intent: user-added hook entries (block-baseline-edit, pre-commit-migration-check)
 * survive regeneration; AISHA-managed entries are refreshed from the new generation.
 *
 * @param {string} existingJson  Current file content (or empty string if file missing).
 * @param {string} generatedJson Content the adapter wants to write.
 * @returns {string}             Merged JSON serialized with 2-space indent.
 */
export function mergeSettingsJson(existingJson, generatedJson) {
  let existing;
  let generated;
  try {
    existing = existingJson.trim() ? JSON.parse(existingJson) : {};
  } catch (e) {
    throw new Error(`mergeSettingsJson: existing JSON invalid: ${e.message}`);
  }
  try {
    generated = JSON.parse(generatedJson);
  } catch (e) {
    throw new Error(`mergeSettingsJson: generated JSON invalid: ${e.message}`);
  }

  const merged = { ...existing };

  // permissions: union arrays
  if (generated.permissions) {
    merged.permissions = merged.permissions || {};
    for (const key of ["allow", "deny"]) {
      const existingArr = Array.isArray(merged.permissions[key]) ? merged.permissions[key] : [];
      const generatedArr = Array.isArray(generated.permissions[key]) ? generated.permissions[key] : [];
      merged.permissions[key] = [...new Set([...existingArr, ...generatedArr])];
    }
  }

  // hooks: per-event, replace managed entries, keep others
  if (generated.hooks) {
    merged.hooks = merged.hooks || {};
    for (const eventName of Object.keys(generated.hooks)) {
      const existingEvent = Array.isArray(merged.hooks[eventName]) ? merged.hooks[eventName] : [];
      const generatedEvent = Array.isArray(generated.hooks[eventName]) ? generated.hooks[eventName] : [];
      merged.hooks[eventName] = mergeHookEvent(existingEvent, generatedEvent);
    }
  }

  // statusLine: if generated says managed, replace
  if (generated.statusLine) {
    if (generated.statusLine._aisha?.managed === true || !merged.statusLine) {
      merged.statusLine = generated.statusLine;
    }
  }

  // _aisha_managed: full replace (it's our metadata)
  if (generated._aisha_managed) {
    merged._aisha_managed = generated._aisha_managed;
  }

  return JSON.stringify(merged, null, 2) + "\n";
}

/**
 * Merge a single hook event's hooks[] array.
 * Strategy: collect generated entries (matcher → [hooks]), remove existing entries
 * with `_aisha.managed === true`, then concat existing-kept + generated.
 * @param {Array} existingEvent  Existing event array (entries with {matcher, hooks: [...]}).
 * @param {Array} generatedEvent Generated event array.
 * @returns {Array}
 */
function mergeHookEvent(existingEvent, generatedEvent) {
  /** @type {Map<string, {existing: Array, generated: Array}>} */
  const byMatcher = new Map();

  for (const entry of existingEvent) {
    const matcher = entry.matcher || "";
    if (!byMatcher.has(matcher)) byMatcher.set(matcher, { existing: [], generated: [] });
    byMatcher.get(matcher).existing = Array.isArray(entry.hooks) ? entry.hooks : [];
  }
  for (const entry of generatedEvent) {
    const matcher = entry.matcher || "";
    if (!byMatcher.has(matcher)) byMatcher.set(matcher, { existing: [], generated: [] });
    byMatcher.get(matcher).generated = Array.isArray(entry.hooks) ? entry.hooks : [];
  }

  /** @type {Array} */
  const merged = [];
  for (const [matcher, { existing, generated }] of byMatcher) {
    const existingKept = existing.filter((h) => h?._aisha?.managed !== true);
    const combined = [...existingKept, ...generated];
    if (combined.length > 0) {
      merged.push(matcher ? { matcher, hooks: combined } : { hooks: combined });
    }
  }
  return merged;
}
