/**
 * Flowboard canvas — palette sidebar.
 *
 * Renders the federated registry grouped by kind. Each item is the "pre-built
 * thing" the user drops onto the canvas; the list itself is whatever the
 * registry providers federated (builtin + agent_catalog + mcp + n8n).
 *
 * @module components/flowboard/NodePalette
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  FLOW_NODE_KINDS,
  type FlowNodeDescriptor,
  type FlowNodeKind,
} from "@/lib/flowboard";

// Category labels are i18n keys under flowboard.kind.* (rendered via t()).
const KIND_TITLE_KEY: Readonly<Record<FlowNodeKind, string>> = {
  trigger: "flowboard.kind.trigger",
  agent: "flowboard.kind.agent",
  tool: "flowboard.kind.tool",
  action: "flowboard.kind.action",
  control: "flowboard.kind.control",
  gate: "flowboard.kind.gate",
};

interface NodePaletteProps {
  descriptors: FlowNodeDescriptor[];
  onAdd: (descriptor: FlowNodeDescriptor) => void;
}

export function NodePalette({ descriptors, onAdd }: NodePaletteProps) {
  const { t } = useTranslation();
  const grouped = useMemo(() => {
    const map = new Map<FlowNodeKind, FlowNodeDescriptor[]>();
    for (const kind of FLOW_NODE_KINDS) map.set(kind, []);
    for (const d of descriptors) map.get(d.kind)?.push(d);
    return map;
  }, [descriptors]);

  return (
    <ScrollArea className="h-full w-64 border-r">
      <div className="space-y-4 p-3">
        <div>
          <h3 className="text-sm font-semibold">{t("flowboard.palette.title")}</h3>
          <p className="text-[11px] text-muted-foreground">{t("flowboard.palette.subtitle")}</p>
        </div>
        {FLOW_NODE_KINDS.map((kind) => {
          const items = grouped.get(kind) ?? [];
          if (items.length === 0) return null;
          return (
            <div key={kind} className="space-y-1">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t(KIND_TITLE_KEY[kind])}
              </div>
              {items.map((d) => (
                <button
                  key={d.typeId}
                  type="button"
                  onClick={() => onAdd(d)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-left text-xs hover:bg-accent"
                  title={d.description}
                >
                  <span className="truncate">{d.label}</span>
                  <Badge variant="outline" className="shrink-0 text-[9px]">
                    {d.source}
                  </Badge>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
