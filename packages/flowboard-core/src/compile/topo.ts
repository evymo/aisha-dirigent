/**
 * Flowboard — topological ordering (Kahn's algorithm).
 *
 * Structurally generic so BOTH the full FlowGraph and a minimal runtime graph
 * ({ nodes: {id}, edges: {source,target} }) share ONE implementation — the
 * svc-ai-chat sandbox executor reuses it instead of duplicating the algorithm.
 * Cycles / unreached nodes are appended in declared order so the order is total.
 *
 * @module flowboard/compile/topo
 */

export function topoOrder<
  G extends {
    nodes: ReadonlyArray<{ id: string }>;
    edges: ReadonlyArray<{ source: string; target: string }>;
  },
>(graph: G): string[] {
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const n of graph.nodes) {
    indegree.set(n.id, 0);
    outgoing.set(n.id, []);
  }
  for (const e of graph.edges) {
    if (!indegree.has(e.source) || !indegree.has(e.target)) continue;
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
    outgoing.get(e.source)?.push(e.target);
  }

  const queue = graph.nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: string[] = [];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d <= 0) queue.push(next);
    }
  }
  for (const n of graph.nodes) if (!seen.has(n.id)) order.push(n.id);
  return order;
}
