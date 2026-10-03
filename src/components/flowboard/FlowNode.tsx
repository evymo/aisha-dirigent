/**
 * Flowboard canvas — generic typed node renderer.
 *
 * One component renders every node kind. Input ports are handles on the left,
 * output ports on the right, each coloured by its port type (the same colour the
 * AISHA Agent node uses for Chat Model / Memory / Tool). Draft nodes proposed by
 * AISHA render ghosted until the user confirms them.
 *
 * @module components/flowboard/FlowNode
 */

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import {
  Bell,
  Bot,
  Box,
  Clock,
  GitBranch,
  Mail,
  NotebookPen,
  Send,
  ShieldCheck,
  Webhook,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PORT_TYPE_META, inputs, outputs, type FlowNodeKind } from "@/lib/flowboard";
import type { FlowCanvasNodeData } from "./types";

const ICONS: Readonly<Record<string, LucideIcon>> = {
  Mail,
  Webhook,
  Clock,
  Bell,
  NotebookPen,
  Send,
  GitBranch,
  ShieldCheck,
  Bot,
  Wrench,
  Workflow,
  Box,
};

const KIND_LABEL: Readonly<Record<FlowNodeKind, string>> = {
  trigger: "Trigger",
  agent: "Agent",
  tool: "Tool",
  action: "Akce",
  control: "Control",
  gate: "Gate",
};

interface FlowNodeProps {
  data: FlowCanvasNodeData;
  selected?: boolean;
}

export const FlowNode = memo(({ data, selected }: FlowNodeProps) => {
  const { descriptor, draft } = data;
  const Icon = ICONS[descriptor.icon] ?? Box;
  const ins = inputs(descriptor.ports);
  const outs = outputs(descriptor.ports);

  return (
    <Card
      className={[
        "min-w-[190px] border-2 p-3 transition-shadow",
        selected ? "ring-2 ring-primary" : "",
        draft ? "border-dashed border-primary/50 opacity-70" : "border-border",
        descriptor.kind === "gate" ? "border-amber-500/60" : "",
      ].join(" ")}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{data.config.label as string ?? descriptor.label}</span>
        </div>
        <Badge variant="outline" className="text-[10px]">
          {KIND_LABEL[descriptor.kind]}
        </Badge>
      </div>

      {descriptor.description ? (
        <p className="mb-1 text-[11px] leading-snug text-muted-foreground">{descriptor.description}</p>
      ) : null}

      {descriptor.egress ? (
        <Badge variant="destructive" className="text-[10px]">egress</Badge>
      ) : null}

      {ins.map((port, i) => (
        <Handle
          key={`in-${port.id}`}
          id={port.id}
          type="target"
          position={Position.Left}
          style={{ top: 44 + i * 18, background: PORT_TYPE_META[port.type].color }}
          title={`${port.label ?? port.id} · ${PORT_TYPE_META[port.type].label}`}
        />
      ))}
      {outs.map((port, i) => (
        <Handle
          key={`out-${port.id}`}
          id={port.id}
          type="source"
          position={Position.Right}
          style={{ top: 44 + i * 18, background: PORT_TYPE_META[port.type].color }}
          title={`${port.label ?? port.id} · ${PORT_TYPE_META[port.type].label}`}
        />
      ))}
    </Card>
  );
});

FlowNode.displayName = "FlowNode";
