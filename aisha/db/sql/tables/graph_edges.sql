-- Table: graph_edges
-- Step:  Step 7 (Hippocampus Graph RAG) — schema landed in
--        aisha/db/migrations/20260518270000_hippocampus_graph.sql
-- Used by: services + RPCs in aisha/db/sql/functions/fn_*_graph_*.sql
-- RLS: ENABLED (see aisha/db/sql/rls/graph_edges.sql +
--      aisha/db/sql/policies/graph_edges_admin_staff_read.sql)

CREATE TABLE IF NOT EXISTS public.graph_edges (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_node_id           uuid NOT NULL REFERENCES public.graph_nodes(id) ON DELETE CASCADE,
  target_node_id           uuid NOT NULL REFERENCES public.graph_nodes(id) ON DELETE CASCADE,
  relationship             text NOT NULL CHECK (relationship IN (
    'USED', 'CITED', 'CAUSED', 'ESCALATED_TO', 'OVERRIDDEN_BY',
    'REFERENCES', 'AUTHORED', 'OWNED_BY', 'DERIVED_FROM', 'PART_OF',
    'PROPOSED_FOR', 'PROMOTED_FROM', 'TAGGED_AS'
  )),
  confidence               numeric(4, 3) DEFAULT 1.0
    CHECK (confidence BETWEEN 0 AND 1),
  source_audit_journal_id  uuid REFERENCES public.audit_journal(id) ON DELETE SET NULL,
  source_ai_run_id         uuid REFERENCES public.ai_runs(id) ON DELETE SET NULL,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_node_id, target_node_id, relationship)
);

ALTER TABLE public.graph_edges ENABLE ROW LEVEL SECURITY;
