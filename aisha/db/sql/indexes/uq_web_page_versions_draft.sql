-- Index: uq_web_page_versions_draft
-- Jeden koncept na stránku. Částečný unikátní index je zároveň cíl pro
-- `ON CONFLICT (page_id) WHERE kind = 'draft'` v save_web_page_draft_admin.

CREATE UNIQUE INDEX IF NOT EXISTS uq_web_page_versions_draft
  ON public.web_page_versions USING btree (page_id) WHERE kind = 'draft';
