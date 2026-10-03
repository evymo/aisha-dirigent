/**
 * @module bringup-contract
 * Single source of truth for the multi-IDE local-stack bring-up contract.
 *
 * Every IDE / agent integration that detects "no AISHA backend reachable" must
 * point the user at the SAME shared entry-point — `npm run stack:bringup` — and
 * parse the SAME final JSON status line. Previously the command + parsing were
 * duplicated only in the VS Code Dirigent extension (SetupPanel.ts) and
 * package.json, with no shared definition. This module is that definition:
 *
 *   - the VS Code / Zed setup panel (extensions/aisha-dirigent SetupPanel.ts)
 *   - the shared MCP server (extensions/aisha-dirigent-claude `aisha_bringup`
 *     tool — reached by BOTH Claude Code and Zed via the stdio bridge)
 *   - the generated IDE instruction files (AGENTS.md / codex SKILL.md /
 *     CLAUDE.md via scripts/ide-adapters/*)
 *
 * ZERO static dependencies by design: this module is bundled into the esbuild
 * extension build (via SetupPanel.ts → STACK_BRINGUP_ARGS), so it must not drag
 * the heavy local-deploy config graph (config/local-presets.mjs →
 * derive-domains.mjs, which uses import.meta) into a CJS bundle. The
 * local-gateway SoT is reached LAZILY through resolveLocalGatewayUrl() — only
 * the node-side adapters (bringup-fragment.mjs) call it; the extension never
 * does. No port is hardcoded here.
 *
 * @see extensions/aisha-dirigent/src/setup-panel/SetupPanel.ts (handleDeployLocalStack)
 * @see extensions/aisha-dirigent-claude/server/tools.mjs (aisha_bringup)
 * @see scripts/ide-adapters/bringup-fragment.mjs (instruction-file fragment)
 */

/**
 * The shared bring-up entry-point. Defined ONCE here; package.json wires the
 * `stack:bringup` script to `scripts/local-warmup.sh` with the canonical flags.
 * Every IDE/agent integration spawns this exact command when no backend is
 * detected — never an ad-hoc warmup invocation.
 * @type {string}
 */
export const STACK_BRINGUP_CMD = "npm run stack:bringup";

/**
 * Same entry-point with an explicit `-- --json` reaffirmation. `stack:bringup`
 * already passes `--json`; the trailing flag is a harmless, edit-surviving
 * guarantee that the final stdout line stays machine-parseable. This is the
 * form spawned programmatically (SetupPanel + the aisha_bringup MCP tool).
 * @type {string}
 */
export const STACK_BRINGUP_CMD_JSON = `${STACK_BRINGUP_CMD} -- --json`;

/**
 * argv form of {@link STACK_BRINGUP_CMD_JSON}, for `spawn(npm, STACK_BRINGUP_ARGS)`.
 * @type {string[]}
 */
export const STACK_BRINGUP_ARGS = ["run", "stack:bringup", "--", "--json"];

/**
 * Resolve the local gateway base URL by REUSING the existing local-gateway SoT
 * (config/local-presets.mjs getLocalGatewayUrl) — never a hardcoded second copy.
 *
 * Lazy dynamic import so this contract module stays dependency-free for the
 * esbuild extension bundle; only node-side callers (the gen:ide adapters) invoke
 * this. If the presets module can't load (e.g. bundled extension context), it
 * falls back to the AISHA_LOCAL_GATEWAY_URL env override, then to the localhost
 * default — so a non-default gateway port stays reachable without the presets.
 *
 * Note: a real bring-up reports the ACTUAL exposed gateway URL on its final JSON
 * line (`gatewayUrl`); this is only the default/expected target before one runs.
 * @returns {Promise<string>}
 */
export async function resolveLocalGatewayUrl() {
  try {
    // Indirected specifier so bundlers (esbuild, for the extension build that
    // imports STACK_BRINGUP_ARGS from this module) do NOT statically follow this
    // into config/local-presets.mjs → derive-domains.mjs (import.meta-using,
    // CJS-incompatible). Only node-side adapters ever reach this code path.
    const presetsSpecifier = ["..", "..", "config", "local-presets.mjs"].join("/");
    const { getLocalGatewayUrl } = await import(presetsSpecifier);
    return getLocalGatewayUrl();
  } catch {
    return process.env.AISHA_LOCAL_GATEWAY_URL || "http://localhost:3001";
  }
}

/**
 * Local gateway /health endpoint the bring-up makes healthy.
 * @returns {Promise<string>}
 */
export async function resolveLocalGatewayHealthUrl() {
  const base = await resolveLocalGatewayUrl();
  return `${base.replace(/\/$/, "")}/health`;
}

/**
 * Human-readable remediation hint emitted into the backend-health / setup
 * section of every generated IDE instruction file. One wording, one place.
 * @type {string}
 */
export const BRINGUP_HINT =
  "If no AISHA backend is reachable on the local gateway, run `" +
  STACK_BRINGUP_CMD +
  "` — non-interactive, health-gated, emits JSON — to bring up the local stack.";

/**
 * Shape of the final machine-readable status line emitted by
 * `npm run stack:bringup -- --json`. Kept in sync with the emitter in
 * scripts/local-warmup.sh and the consumer in SetupPanel.ts (BringupResult).
 *
 * @typedef {object} BringupResult
 * @property {string|null} preset
 * @property {string|null} apps
 * @property {string|null} composeFile
 * @property {string|null} envFile
 * @property {boolean} healthy
 * @property {Array<{name:string,status:string,http_code?:string,stack?:string}>} services
 * @property {string|null} gatewayUrl
 */

/**
 * Extract the final brace-delimited JSON status line from a captured stdout
 * stream of `stack:bringup --json`. Mirrors the line-scan in SetupPanel.ts so
 * every consumer parses the bring-up result identically.
 *
 * @param {string} stdout  full captured stdout
 * @returns {BringupResult|null} the last parseable JSON object line, or null
 */
export function parseBringupResult(stdout) {
  let result = null;
  for (const raw of String(stdout || "").split("\n")) {
    const line = raw.trim();
    if (line.startsWith("{") && line.endsWith("}")) {
      try {
        result = JSON.parse(line);
      } catch {
        // Brace-delimited line that isn't valid JSON — log so a malformed
        // status line is observable, then keep scanning for a later valid one.
        console.warn(
          `[bringup-contract] skipped a brace-delimited stdout line that did not parse as JSON: ${line.slice(0, 120)}`,
        );
      }
    }
  }
  return result;
}
