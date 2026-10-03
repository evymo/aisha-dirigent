-- Index: idx_knowledge_items_source_concept (Brick5)
--
-- Non-unique. Supports the DISTINCT ON (source_concept_id) variant-dedup in
-- mcp_search_knowledge_v2/v3 (group locale variants of one source node so cross-lingual
-- near-duplicates collapse to one winning variant per concept).
CREATE INDEX IF NOT EXISTS idx_knowledge_items_source_concept
  ON public.knowledge_items USING btree (source_concept_id);
