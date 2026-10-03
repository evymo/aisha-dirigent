-- Index: idx_kmm_pages_pending

CREATE INDEX IF NOT EXISTS idx_kmm_pages_pending ON public.knowledge_multimodal_pages USING btree (status) WHERE (status = 'pending'::text);
