-- Index: uq_news_article_versions_draft
-- Jeden koncept na článek. Částečný unikátní index je zároveň cíl pro
-- `ON CONFLICT (article_id) WHERE kind = 'draft'` v save_news_article_draft_admin.

CREATE UNIQUE INDEX IF NOT EXISTS uq_news_article_versions_draft
  ON public.news_article_versions USING btree (article_id) WHERE kind = 'draft';
