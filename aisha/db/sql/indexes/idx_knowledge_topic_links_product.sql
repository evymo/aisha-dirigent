-- Index: idx_knowledge_topic_links_product
CREATE INDEX IF NOT EXISTS idx_knowledge_topic_links_product
  ON public.knowledge_topic_links(product_id)
  WHERE product_id IS NOT NULL;
