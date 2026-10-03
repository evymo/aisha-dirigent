/**
 * @fileoverview Sankey flow diagram for production substance tracking.
 * Builds a directed graph from flow records and renders a Sankey diagram
 * using recharts. Each node is a flow graph vertex, each link is
 * aggregated volume between two nodes.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Sankey, Tooltip, Rectangle, Layer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";
import type { FlowRecord, FlowNode } from "@/hooks";

/** Node shape in recharts Sankey data */
interface SankeyNodeData {
  name: string;
}

/** Link shape in recharts Sankey data */
interface SankeyLinkData {
  source: number;
  target: number;
  value: number;
}

interface FlowSankeyDiagramProps {
  nodes: FlowNode[];
  records: FlowRecord[];
}

/** Custom node rendering for Sankey with labels */
function SankeyNodeShape(props: Record<string, unknown>) {
  const { x, y, width, height, payload } = props as {
    height: number;
    payload: { name: string };
    width: number;
    x: number;
    y: number;
  };
  return (
    <Layer key={`node-${payload.name}`}>
      <Rectangle
        x={x}
        y={y}
        width={width}
        height={height}
        fill="hsl(var(--primary))"
        fillOpacity={0.8}
      />
      <text
        x={x + width + 6}
        y={y + height / 2}
        textAnchor="start"
        dominantBaseline="central"
        className="fill-foreground text-xs"
      >
        {payload.name}
      </text>
    </Layer>
  );
}

/**
 * Sankey diagram visualizing substance flows between production nodes.
 * Aggregates flow record volumes per source→target pair.
 */
export default function FlowSankeyDiagram({
  nodes,
  records,
}: FlowSankeyDiagramProps) {
  const { t } = useTranslation();

  const sankeyData = useMemo(() => {
    if (!nodes || nodes.length === 0 || !records || records.length === 0) {
      return null;
    }

    // Build node index map — only include nodes that appear in records
    const usedNodeIds = new Set<string>();
    for (const r of records) {
      if (r.source_node_id) usedNodeIds.add(r.source_node_id);
      if (r.target_node_id) usedNodeIds.add(r.target_node_id);
    }

    const activeNodes = nodes.filter((n) => usedNodeIds.has(n.id));
    if (activeNodes.length < 2) return null;

    const nodeIndexMap = new Map<string, number>();
    const sankeyNodes: SankeyNodeData[] = [];
    activeNodes.forEach((n, idx) => {
      nodeIndexMap.set(n.id, idx);
      sankeyNodes.push({ name: `${n.node_code} (${n.node_name})` });
    });

    // Aggregate volumes per source→target pair
    const linkMap = new Map<string, number>();
    for (const r of records) {
      if (!r.source_node_id || !r.target_node_id) continue;
      const sourceIdx = nodeIndexMap.get(r.source_node_id);
      const targetIdx = nodeIndexMap.get(r.target_node_id);
      if (sourceIdx === undefined || targetIdx === undefined) continue;
      if (sourceIdx === targetIdx) continue;
      const key = `${sourceIdx}-${targetIdx}`;
      linkMap.set(key, (linkMap.get(key) ?? 0) + r.volume_l);
    }

    const sankeyLinks: SankeyLinkData[] = [];
    for (const [key, value] of linkMap) {
      const [source, target] = key.split("-").map(Number);
      if (value > 0) {
        sankeyLinks.push({ source, target, value });
      }
    }

    if (sankeyLinks.length === 0) return null;

    return { nodes: sankeyNodes, links: sankeyLinks };
  }, [nodes, records]);

  if (!sankeyData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            {t("admin.production.flow.sankey.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            {t("admin.production.flow.sankey.noData")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5" />
          {t("admin.production.flow.sankey.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Sankey
            width={800}
            height={400}
            data={sankeyData}
            node={SankeyNodeShape}
            nodePadding={30}
            margin={{ top: 20, right: 160, bottom: 20, left: 20 }}
            link={{ stroke: "hsl(var(--primary))", strokeOpacity: 0.3 }}
          >
            <Tooltip
              formatter={(value: number) => [`${value.toFixed(2)} l`, t("admin.production.flow.sankey.volumeLabel")]}
            />
          </Sankey>
        </div>
      </CardContent>
    </Card>
  );
}
