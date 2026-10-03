/**
 * Shared helpers for the n8n workflow gate tests.
 *
 * The gate tests repeatedly locate a node with `wf.nodes.find(...)` and then
 * assert on it. `Array.prototype.find` returns `N8nNode | undefined`, and
 * vitest's `expect(x).toBeDefined()` does NOT narrow the static type — so
 * every subsequent `node.parameters.*` access is a `possibly undefined`
 * type error. `requireNode` collapses the find + existence assertion into a
 * single call that THROWS (failing the test) when the node is absent, which
 * both documents the gate's expectation and narrows the return type so
 * callers can read `.parameters.*` directly.
 */
import type { N8nNode, N8nWorkflow } from "./_types";

/** An {@link N8nNode} guaranteed to carry a (non-optional) `parameters` object. */
export type N8nNodeWithParams = N8nNode & {
  parameters: NonNullable<N8nNode["parameters"]>;
};

/**
 * Find the single workflow node matching `predicate`, asserting it exists and
 * carries a `parameters` object. Throws (failing the enclosing test) otherwise.
 *
 * @param wf        parsed workflow
 * @param predicate node matcher
 * @param label     optional context for the thrown message
 */
export function requireNode(
  wf: N8nWorkflow,
  predicate: (n: N8nNode) => boolean,
  label?: string,
): N8nNodeWithParams {
  const suffix = label ? ` (${label})` : "";
  const node = wf.nodes.find(predicate);
  if (!node) {
    throw new Error(`requireNode: no node matched predicate${suffix}`);
  }
  if (!node.parameters) {
    throw new Error(`requireNode: node '${node.id}' has no parameters${suffix}`);
  }
  return node as N8nNodeWithParams;
}
