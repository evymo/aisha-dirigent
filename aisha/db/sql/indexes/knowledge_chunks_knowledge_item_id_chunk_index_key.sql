-- Index: knowledge_chunks_knowledge_item_id_chunk_index_key

-- Widened with locale (Brick3): the same source chunk (item, chunk_index) may
-- now coexist once per locale. Behavior-neutral today (all rows locale='global').
CREATE UNIQUE INDEX knowledge_chunks_knowledge_item_id_chunk_index_key ON public.knowledge_chunks USING btree (knowledge_item_id, chunk_index, locale);
