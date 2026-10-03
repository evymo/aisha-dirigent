/**
 * Shared fixtures for Flowboard tests — a federated registry built from the
 * builtin set plus mock agent_catalog and MCP providers (no DB / network).
 */

import {
  agentCatalogProvider,
  buildFlowRegistry,
  builtinProvider,
  mcpToolProvider,
  type FlowRegistry,
} from "@/lib/flowboard/registry";
import { flowGraphSchema, type FlowGraph } from "@/lib/flowboard/graph";

export async function makeRegistry(): Promise<FlowRegistry> {
  return buildFlowRegistry([
    builtinProvider(),
    agentCatalogProvider(async () => [
      { slug: "knowledge", purpose: "Knowledge base agent", safety_level: "standard" },
      { slug: "guardian", purpose: "Sensitive agent", safety_level: "critical" },
    ]),
    mcpToolProvider(async () => [
      { name: "search_knowledge", description: "Hybrid KB search" },
    ]),
  ]);
}

export function makeGraph(
  nodes: Array<{ id: string; typeId: string; config?: Record<string, unknown> }>,
  edges: Array<{
    id: string;
    source: string;
    sourcePort: string;
    target: string;
    targetPort: string;
  }>,
): FlowGraph {
  return flowGraphSchema.parse({
    id: "g1",
    name: "Test flow",
    nodes: nodes.map((n, i) => ({
      id: n.id,
      typeId: n.typeId,
      position: { x: i * 200, y: 0 },
      config: n.config ?? {},
    })),
    edges,
  });
}
