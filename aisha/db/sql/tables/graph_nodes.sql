-- Table: graph_nodes
-- Step:  Step 7 (Hippocampus Graph RAG) — schema landed in
--        aisha/db/migrations/20260518270000_hippocampus_graph.sql
-- Used by: services + RPCs in aisha/db/sql/functions/fn_*_graph_*.sql
-- RLS: ENABLED (see aisha/db/sql/rls/graph_nodes.sql +
--      aisha/db/sql/policies/graph_nodes_admin_staff_read.sql)

CREATE TABLE IF NOT EXISTS public.graph_nodes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  text NOT NULL CHECK (entity_type IN (
    'Story', 'Agent', 'Plugin', 'KnowledgeItem', 'ExpertRule',
    'User', 'AuditEvent', 'Run', 'Memory', 'Proposal', 'Concept'
  )),
  entity_slug  text,
  entity_label text NOT NULL,
  source_table text,
  source_id    uuid,
  embedding    vector(2560),
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  story_id     uuid REFERENCES public.partner_stories(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_slug, story_id)
);

COMMENT ON TABLE public.graph_nodes IS
  'Step 7: typed entity table for Hippocampus Graph RAG. Bootstrapped from existing AISHA primitives + extended via LLM extraction (capability-resolver rag.graph_extract).';

ALTER TABLE public.graph_nodes ENABLE ROW LEVEL SECURITY;

-- updated_at maintenance: trigger ships in
-- aisha/db/sql/triggers/set_graph_nodes_updated_at.sql.
