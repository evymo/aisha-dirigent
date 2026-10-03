-- Index: idx_knowledge_items_source_unique

-- Brick4: widen the guild_db source-identity unique to include locale, so each
-- (source_type, source_id, locale) is its own knowledge_item — locale variants of one
-- source node coexist instead of colliding on the old (source_type, source_id) key.
-- DROP first: the indexed column set changed, so a bare CREATE would conflict with the
-- existing 2-col index in an applied DB.
DROP INDEX IF EXISTS public.idx_knowledge_items_source_unique;
CREATE UNIQUE INDEX idx_knowledge_items_source_unique ON public.knowledge_items USING btree (source_type, source_id, locale) WHERE (source_type = 'guild_db'::text);
