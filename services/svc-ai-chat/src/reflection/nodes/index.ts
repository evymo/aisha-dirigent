import type { NodeHandler, NodeType } from '../types.js';
import { generator } from './generator.js';
import { critic } from './critic.js';
import { convergenceGate } from './convergence_gate.js';
import { corrector } from './corrector.js';
import { hippocampusRead, hippocampusWrite } from './hippocampus.js';
import { interruptNode } from './interrupt.js';
import { cosmosAnchor } from './cosmos.js';
import { occipitumCreative } from './occipitum.js';
import { openclawPlan, openclawSandbox, openclawNotify } from './openclaw.js';
import { openclawResolveClow } from './openclaw_resolve_clow.js';
import { soulforgeClassify, soulforgeOptimize } from './soulforge.js';
import { mcpTest } from './mcp_test.js';
import { totPlanner } from './tot_planner.js';
import { totExpand } from './tot_expand.js';
import { totEvaluate } from './tot_evaluate.js';
import { totSearch } from './tot_search.js';
import { runtimeDispatch } from './runtime_dispatch.js';

export const NODE_HANDLERS: Record<NodeType, NodeHandler> = {
  generator,
  critic,
  convergence_gate: convergenceGate,
  corrector,
  hippocampus_read: hippocampusRead,
  hippocampus_write: hippocampusWrite,
  interrupt: interruptNode,
  cosmos_anchor: cosmosAnchor,
  occipitum_creative: occipitumCreative,
  openclaw_plan: openclawPlan,
  openclaw_sandbox: openclawSandbox,
  openclaw_notify: openclawNotify,
  openclaw_resolve_clow: openclawResolveClow,
  soulforge_classify: soulforgeClassify,
  soulforge_optimize: soulforgeOptimize,
  mcp_test: mcpTest,
  tot_planner: totPlanner,
  tot_expand: totExpand,
  tot_evaluate: totEvaluate,
  tot_search: totSearch,
  runtime_dispatch: runtimeDispatch,
};
