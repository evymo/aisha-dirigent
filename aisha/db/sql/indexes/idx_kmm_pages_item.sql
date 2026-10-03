-- Index: idx_kmm_pages_item

CREATE INDEX IF NOT EXISTS idx_kmm_pages_item ON public.knowledge_multimodal_pages USING btree (knowledge_item_id, page_number);
