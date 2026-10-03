-- Index: idx_news_article_versions_article
-- Historie článku se čte vždy pro jeden článek, od nejnovější verze.

CREATE INDEX IF NOT EXISTS idx_news_article_versions_article
  ON public.news_article_versions USING btree (article_id, version_number DESC);
