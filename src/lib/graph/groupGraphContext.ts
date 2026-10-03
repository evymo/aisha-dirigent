/**
 * Pure grouper for fn_get_run_graph_context rows.
 *
 * Step 7.3 — Hippocampus explainability panel. Extracted from the data hook
 * so it can be unit-tested without pulling in @/integrations/db/client (which
 * has eager side effects via the realtime URL check at module load).
 */
import type { GraphContextRow } from "@/schemas/rpcResponseSchemas";

/**
 * Result of folding multiple seed→target rows into one entry per target.
 * Keeps the highest cumulative_confidence path and accumulates the list
 * of seeds that reached this target.
 */
export interface GroupedGraphContext {
  target_node_id: string;
  target_entity_type: string;
  target_label: string;
  best_depth: number;
  best_confidence: number | null;
  best_last_relationship: string | null;
  seeds: Array<{ seed_node_id: string; seed_label: string; seed_entity_type: string }>;
}

/**
 * Collapse flat rows to a per-target list sorted by best_confidence DESC,
 * then best_depth ASC. Used by ExplainabilityPanel.tsx.
 */
export function groupByTarget(rows: GraphContextRow[]): GroupedGraphContext[] {
  const byId = new Map<string, GroupedGraphContext>();
  for (const row of rows) {
    const existing = byId.get(row.target_node_id);
    if (!existing) {
      byId.set(row.target_node_id, {
        target_node_id: row.target_node_id,
        target_entity_type: row.target_entity_type,
        target_label: row.target_label,
        best_depth: row.depth,
        best_confidence: row.cumulative_confidence,
        best_last_relationship: row.last_relationship,
        seeds: [{
          seed_node_id: row.seed_node_id,
          seed_label: row.seed_label,
          seed_entity_type: row.seed_entity_type,
        }],
      });
      continue;
    }
    if (!existing.seeds.some((s) => s.seed_node_id === row.seed_node_id)) {
      existing.seeds.push({
        seed_node_id: row.seed_node_id,
        seed_label: row.seed_label,
        seed_entity_type: row.seed_entity_type,
      });
    }
    const incomingConfidence = row.cumulative_confidence ?? -1;
    const existingConfidence = existing.best_confidence ?? -1;
    if (
      incomingConfidence > existingConfidence ||
      (incomingConfidence === existingConfidence && row.depth < existing.best_depth)
    ) {
      existing.best_depth = row.depth;
      existing.best_confidence = row.cumulative_confidence;
      existing.best_last_relationship = row.last_relationship;
    }
  }
  return Array.from(byId.values()).sort((a, b) => {
    const aConf = a.best_confidence ?? -1;
    const bConf = b.best_confidence ?? -1;
    if (bConf !== aConf) return bConf - aConf;
    return a.best_depth - b.best_depth;
  });
}
