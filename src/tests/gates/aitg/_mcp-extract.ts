/**
 * Shared extractors for AITG plugin-boundary gates.
 *
 * Why this exists
 * ---------------
 * The MCP plugin manifest in svc-mcp-knowledge/src/routes/mcp.ts uses a
 * Set-spread + wildcard-dispatcher pattern to avoid 19× duplication for
 * the AITG tool family:
 *
 *   const AITG_TOOLS = new Set<string>([ 'aitg_run_test', ...18 more ]);
 *   const ADMIN_TOOLS = new Set<string>([ 'admin_health_check', ..., ...AITG_TOOLS ]);
 *
 *   // in callTool():
 *   default:
 *     if (AITG_TOOLS.has(name)) return aitgDispatch(name, ...);
 *
 * The gate's *spec* is unchanged: every declared tool must be reachable
 * (dispatched) and ACL'd. Only the gate's *parser* needs to understand
 * the spread + wildcard-dispatcher idioms so the DRY refactor doesn't
 * register as a phantom violation.
 *
 * Both extractors transitively resolve `...SET_NAME` spreads by walking
 * the source for a matching `const SET_NAME = new Set([...])` declaration.
 */

/**
 * Extract literal string members from `const <setName> = new Set<...>([...])`,
 * recursively expanding any `...OTHER_SET` spreads found inside.
 */
export function extractSetLiterals(
  source: string,
  setName: string,
  visited: Set<string> = new Set(),
): string[] {
  if (visited.has(setName)) return [];
  visited.add(setName);

  const decl = source.indexOf(`const ${setName}`);
  if (decl < 0) return [];
  // Find the matching `]);` after the `new Set(`. A naive `indexOf(']);')`
  // works because Set literals in this codebase don't nest other arrays.
  const end = source.indexOf(']);', decl);
  if (end < 0) return [];
  const body = source.slice(decl, end);

  const literals = [...body.matchAll(/'([\w-]+)'/g)].map((m) => m[1]);
  const spreads = [...body.matchAll(/\.\.\.([A-Z_][A-Z0-9_]*)/g)].map((m) => m[1]);
  for (const spreadName of spreads) {
    literals.push(...extractSetLiterals(source, spreadName, visited));
  }
  return literals;
}

/**
 * Extract every tool name declared in TOOL_DEFINITIONS (the canonical
 * plugin surface).
 */
export function extractToolDefinitions(source: string): string[] {
  const start = source.indexOf('const TOOL_DEFINITIONS');
  const end = source.indexOf('];', start);
  if (start < 0 || end < 0) return [];
  return [...source.slice(start, end).matchAll(/tool\(\s*'([\w-]+)'/g)].map((m) => m[1]);
}

/**
 * Extract every tool name effectively dispatched by `callTool`.
 *
 * Recognizes two patterns:
 *   1. `case 'name':` — per-tool literal dispatch.
 *   2. `if (SET.has(name)) return X(name, ...)` — wildcard dispatch that
 *      routes every member of `SET` to a single handler.
 *
 * Pattern (2) was introduced in commit 5828bc16 to consolidate the AITG
 * family. The extractor resolves SET to its literal members so dispatch
 * coverage matches what the runtime actually serves.
 */
export function extractDispatchedTools(source: string): string[] {
  const start = source.indexOf('async function callTool');
  const end = source.indexOf('export async function mcpRoutes', start);
  if (start < 0 || end < 0) return [];
  const body = source.slice(start, end);

  const literalCases = [...body.matchAll(/case '([\w-]+)':/g)].map((m) => m[1]);
  const wildcardSets = [...body.matchAll(/if\s*\(\s*([A-Z_][A-Z0-9_]*)\.has\(/g)].map((m) => m[1]);

  const wildcardCases: string[] = [];
  for (const setName of wildcardSets) {
    wildcardCases.push(...extractSetLiterals(source, setName));
  }
  return [...literalCases, ...wildcardCases];
}

/**
 * Extract every tool name in an ACL set (AUTHENTICATED_TOOLS / ADMIN_TOOLS),
 * transitively resolving `...OTHER_SET` spreads.
 */
export function extractAclMembers(
  source: string,
  marker: 'AUTHENTICATED_TOOLS' | 'ADMIN_TOOLS',
): string[] {
  return extractSetLiterals(source, marker);
}
