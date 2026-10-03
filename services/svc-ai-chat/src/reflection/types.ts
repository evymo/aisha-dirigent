import { z } from 'zod';

// =========================================================================
// Graph schema (stored in ai_workflow_definitions.graph JSONB)
// =========================================================================

export const NodeTypeSchema = z.enum([
  'generator',
  'critic',
  'convergence_gate',
  'corrector',
  'hippocampus_read',
  'hippocampus_write',
  'interrupt',
  'cosmos_anchor',
  'occipitum_creative',
  'openclaw_plan',
  'openclaw_sandbox',
  'openclaw_notify',
  'openclaw_resolve_clow',  // Per-clow backend dispatch (Phase 5)
  'soulforge_classify',
  'soulforge_optimize',
  'mcp_test',               // Probe an MCP server before relying on it (Phase 5)
  'tot_planner',            // Tree-of-Thoughts v1: decomposition + policy (E1)
  'tot_expand',             // Tree-of-Thoughts v1: parallel generate-k (E1)
  'tot_evaluate',           // Tree-of-Thoughts v1: Sure/Maybe/Impossible scoring (E1)
  'tot_search',             // Tree-of-Thoughts v1: BFS/DFS/beam controller (E1)
  'runtime_dispatch',       // E3: execute a clow through its DERIVED runtime (direct_llm/openclaw/hermes)
]);
export type NodeType = z.infer<typeof NodeTypeSchema>;

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  type: NodeTypeSchema,
  config: z.record(z.string(), z.unknown()).default({}),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  /** JS-evaluable condition like 'score >= 0.85' or 'warnings.length > 0' */
  condition: z.string().optional(),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const GraphSchema = z.object({
  entry: z.string().min(1),
  nodes: z.array(GraphNodeSchema).min(1),
  edges: z.array(GraphEdgeSchema),
  /**
   * Per-graph iteration cap override (E0.6). When set, wins over the env default
   * (LANGGRAPH_MAX_ITERATIONS, 20) so a high-fanout graph (e.g. a Tree-of-Thoughts
   * deliberation) can raise its own ceiling without a global env change. Absent →
   * the env default applies.
   */
  max_iterations: z.number().int().positive().optional(),
});
export type Graph = z.infer<typeof GraphSchema>;

// =========================================================================
// Runtime state
// =========================================================================

export interface RunCheckpoint {
  current_node: string | null;
  iteration: number;
  history: Array<{
    node_id: string;
    node_type: NodeType;
    started_at: string;
    ended_at?: string;
    output_summary?: Record<string, unknown>;
    transition_key?: string;
  }>;
  // Accumulated state passed across nodes
  state: Record<string, unknown>;
}

export interface RunRecord {
  id: string;
  kind: string;
  story_id: string | null;
  actor_user_id: string | null;
  status: 'pending' | 'running' | 'waiting_human' | 'waiting_batch' | 'completed' | 'failed' | 'cancelled' | 'blocked';
  workflow_definition_id: string;
  metadata: {
    workflow_name?: string;
    workflow_version?: number;
    input?: Record<string, unknown>;
    context?: Record<string, unknown>;
    checkpoint?: RunCheckpoint;
    [k: string]: unknown;
  };
  cost_total_json: Record<string, unknown>;
}

export interface WorkflowDefinitionRecord {
  id: string;
  name: string;
  display_name: string;
  graph: Graph;
  context: string;
  is_active: boolean;
  version: number;
  metadata: Record<string, unknown>;
}

// =========================================================================
// Node handler protocol
// =========================================================================

export interface NodeContext {
  run: RunRecord;
  workflow: WorkflowDefinitionRecord;
  node: GraphNode;
  // Mutable state shared across nodes
  state: Record<string, unknown>;
  iteration: number;
}

export interface NodeOutput {
  /** Optional state mutations to merge */
  state_patch?: Record<string, unknown>;
  /** Tokens consumed (if LLM call) */
  tokens_input?: number;
  tokens_output?: number;
  /** Output data for ai_workflow_node_runs.output_data */
  output_data: Record<string, unknown>;
  /** Transition key used to select next edge */
  transition_key?: string;
  /** When true, runner pauses the run with status=waiting_human */
  interrupt?: boolean;
  /**
   * When true, runner pauses the run with status=waiting_batch (provider
   * batch API in-flight; WF_BATCH_POLLER will pick up result). The node
   * must also populate state_patch.batch_job_id + batch_provider so a
   * future WF_BATCH_RESUMER can find + resume the run when ready.
   */
  batch_suspend?: boolean;
  /** When true, runner marks status=failed */
  fatal_error?: string;
}

export type NodeHandler = (ctx: NodeContext) => Promise<NodeOutput>;

// =========================================================================
// HTTP API
// =========================================================================

export const RunStartRequestSchema = z.object({
  run_id: z.string().uuid(),
});
export type RunStartRequest = z.infer<typeof RunStartRequestSchema>;

export const HumanApprovalSchema = z.object({
  run_id: z.string().uuid(),
  approved: z.boolean(),
  approver_user_id: z.string().uuid().optional(),
  note: z.string().optional(),
});
export type HumanApproval = z.infer<typeof HumanApprovalSchema>;
