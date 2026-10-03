/**
 * Safe merge helper for `.mcp.json` (CLI counterpart).
 *
 * Mirrors the extension twin in
 * extensions/aisha-dirigent/src/generators/multi-file.ts::mergeMcpJson.
 *
 * Guarantee: a single managed MCP server entry is upserted into the file
 * WITHOUT discarding any other `mcpServers` entries the user added by hand,
 * and without dropping unrelated top-level keys. Empty / malformed input is
 * treated as `{}` — the file is NEVER thrown away on a parse failure.
 *
 * @module
 */

/**
 * Merge a single MCP server definition into existing `.mcp.json` text.
 *
 * @param {string} existingText  Current `.mcp.json` content (or "" if missing).
 * @param {string} name          Server key to upsert under `mcpServers`.
 * @param {object} server        Server definition (e.g. { type, url } or { command, args }).
 * @returns {string}             Merged JSON serialized with 2-space indent + trailing newline.
 */
export function mergeMcpJson(existingText, name, server) {
  let existing;
  try {
    existing = existingText && existingText.trim() ? JSON.parse(existingText) : {};
  } catch (err) {
    // Never discard the file on a parse error — treat as empty and re-seed.
    // Warn so a corrupted .mcp.json (and the loss of any hand-added entries it
    // held) is observable instead of being silently overwritten.
    console.warn(
      `[mcp-json-merge] existing .mcp.json did not parse as JSON (${err.message}); ` +
        "treating as empty and re-seeding — any hand-added entries could not be preserved.",
    );
    existing = {};
  }
  if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
    existing = {};
  }

  const merged = { ...existing };
  const existingServers =
    typeof merged.mcpServers === "object" && merged.mcpServers !== null && !Array.isArray(merged.mcpServers)
      ? merged.mcpServers
      : {};
  merged.mcpServers = { ...existingServers, [name]: server };

  return JSON.stringify(merged, null, 2) + "\n";
}
