-- Index: idx_knowledge_topic_links_batch
CREATE INDEX IF NOT EXISTS idx_knowledge_topic_links_batch
  ON public.knowledge_topic_links(production_batch_id)
  WHERE production_batch_id IS NOT NULL;
