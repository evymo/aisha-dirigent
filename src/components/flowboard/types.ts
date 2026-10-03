/**
 * Flowboard canvas — node data carried by @xyflow nodes.
 * @module components/flowboard/types
 */

import type { Node } from "@xyflow/react";
import type { FlowNodeDescriptor } from "@/lib/flowboard";

export interface FlowCanvasNodeData extends Record<string, unknown> {
  descriptor: FlowNodeDescriptor;
  config: Record<string, unknown>;
  draft: boolean;
}

export type FlowCanvasNode = Node<FlowCanvasNodeData, "flowNode">;
