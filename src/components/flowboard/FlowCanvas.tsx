/**
 * Flowboard canvas — free-form visual builder.
 *
 * A generalisation of the production WorkflowDesigner: a @xyflow canvas whose
 * palette is the federated registry, whose edges are validated live against the
 * typed port system, and which serialises to the engine-agnostic FlowGraph.
 *
 * The same surface receives AISHA-authored drafts (ghost nodes) via `onAskAisha`
 * and lets the user finish + publish them — the GrapesJS loop applied to flows.
 *
 * @module components/flowboard/FlowCanvas
 */

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  canConnect,
  getPort,
  mergeRegistry,
  selectEngine,
  validateGraph,
  type FlowGraph,
  type FlowNodeDescriptor,
} from "@/lib/flowboard";
import { FlowNode } from "./FlowNode";
import { NodePalette } from "./NodePalette";
import type { FlowCanvasNodeData } from "./types";

const nodeTypes = { flowNode: FlowNode };
let idSeq = 1;
const nextId = (): string => `n${idSeq++}`;

export interface FlowCanvasProps {
  descriptors: FlowNodeDescriptor[];
  initialGraph?: FlowGraph;
  onSave?: (graph: FlowGraph) => void;
  onAskAisha?: (prompt: string) => Promise<FlowGraph | void>;
}

function FlowCanvasInner({ descriptors, initialGraph, onSave, onAskAisha }: FlowCanvasProps) {
  const { t } = useTranslation();
  const registry = useMemo(() => mergeRegistry([descriptors]), [descriptors]);
  const byTypeId = useMemo(() => {
    const m = new Map<string, FlowNodeDescriptor>();
    for (const d of descriptors) m.set(d.typeId, d);
    return m;
  }, [descriptors]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowCanvasNodeData>>(
    initialGraph ? hydrateNodes(initialGraph, byTypeId) : [],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    initialGraph ? hydrateEdges(initialGraph) : [],
  );
  const [warning, setWarning] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");

  const descriptorOfNode = useCallback(
    (nodeId: string): FlowNodeDescriptor | undefined => {
      const n = nodes.find((x) => x.id === nodeId);
      return n ? byTypeId.get(n.data.descriptor.typeId) : undefined;
    },
    [nodes, byTypeId],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const srcD = c.source ? descriptorOfNode(c.source) : undefined;
      const tgtD = c.target ? descriptorOfNode(c.target) : undefined;
      const outPort = srcD && c.sourceHandle ? getPort(srcD, c.sourceHandle) : undefined;
      const inPort = tgtD && c.targetHandle ? getPort(tgtD, c.targetHandle) : undefined;
      if (!outPort || !inPort || !canConnect(outPort, inPort)) {
        setWarning(
          outPort && inPort
            ? t("flowboard.canvas.cannotConnect", { from: outPort.type, to: inPort.type })
            : t("flowboard.canvas.invalidConnection"),
        );
        return;
      }
      setWarning(null);
      setEdges((eds) => addEdge({ ...c, type: "smoothstep" }, eds));
    },
    [descriptorOfNode, setEdges, t],
  );

  const addNode = useCallback(
    (descriptor: FlowNodeDescriptor) => {
      const node: Node<FlowCanvasNodeData> = {
        id: nextId(),
        type: "flowNode",
        position: { x: 80 + Math.random() * 280, y: 80 + Math.random() * 200 },
        data: { descriptor, config: { ...descriptor.defaultConfig }, draft: false },
      };
      setNodes((nds) => [...nds, node]);
    },
    [setNodes],
  );

  const toGraph = useCallback((): FlowGraph => {
    return {
      id: initialGraph?.id ?? "draft",
      version: (initialGraph?.version ?? 0) + 1,
      name: initialGraph?.name ?? "Nový flow",
      nodes: nodes.map((n) => ({
        id: n.id,
        typeId: n.data.descriptor.typeId,
        position: n.position,
        config: n.data.config,
        draft: n.data.draft,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        sourcePort: e.sourceHandle ?? "out",
        target: e.target,
        targetPort: e.targetHandle ?? "in",
      })),
      meta: initialGraph?.meta ?? {},
    };
  }, [nodes, edges, initialGraph]);

  const graph = toGraph();
  const validation = validateGraph(graph, registry);
  const decision = nodes.length > 0 ? selectEngine(graph, registry) : null;

  const askAisha = useCallback(async () => {
    if (!onAskAisha || prompt.trim().length === 0) return;
    const proposed = await onAskAisha(prompt.trim());
    if (!proposed) return;
    setNodes(hydrateNodes(proposed, byTypeId, true));
    setEdges(hydrateEdges(proposed));
  }, [onAskAisha, prompt, byTypeId, setNodes, setEdges]);

  return (
    <div className="flex h-full w-full">
      <NodePalette descriptors={descriptors} onAdd={addNode} />
      <div className="relative h-full flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
        >
          <Background variant={BackgroundVariant.Dots} gap={16} />
          <MiniMap pannable zoomable />
          <Controls />

          <Panel position="top-left" className="flex items-center gap-2">
            {decision ? (
              <Badge variant={decision.target === "sandbox" ? "secondary" : "outline"}>
                engine: {decision.target}
              </Badge>
            ) : null}
            <Badge variant={validation.ok ? "outline" : "destructive"}>
              {validation.ok
                ? t("flowboard.canvas.valid")
                : t("flowboard.canvas.errors", { count: validation.errors.length })}
            </Badge>
          </Panel>

          <Panel position="top-right" className="flex items-center gap-2">
            {onAskAisha ? (
              <>
                <Input
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={t("flowboard.canvas.descriptionPlaceholder")}
                  className="h-8 w-64"
                />
                <Button size="sm" variant="secondary" onClick={askAisha}>
                  {t("flowboard.canvas.askAisha")}
                </Button>
              </>
            ) : null}
            <Button size="sm" onClick={() => onSave?.(toGraph())} disabled={!validation.ok}>
              {t("flowboard.canvas.save")}
            </Button>
          </Panel>

          {warning ? (
            <Panel position="bottom-center">
              <Badge variant="destructive">{warning}</Badge>
            </Panel>
          ) : null}
        </ReactFlow>
      </div>
    </div>
  );
}

export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function hydrateNodes(
  graph: FlowGraph,
  byTypeId: Map<string, FlowNodeDescriptor>,
  asDraft = false,
): Node<FlowCanvasNodeData>[] {
  return graph.nodes
    .map((n): Node<FlowCanvasNodeData> | null => {
      const descriptor = byTypeId.get(n.typeId);
      if (!descriptor) return null;
      return {
        id: n.id,
        type: "flowNode" as const,
        position: n.position,
        data: { descriptor, config: n.config, draft: asDraft || n.draft },
      };
    })
    .filter((n): n is Node<FlowCanvasNodeData> => n !== null);
}

function hydrateEdges(graph: FlowGraph): Edge[] {
  return graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourcePort,
    targetHandle: e.targetPort,
    type: "smoothstep",
  }));
}
