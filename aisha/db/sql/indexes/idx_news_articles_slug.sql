-- Index: idx_news_articles_slug

CREATE INDEX idx_news_articles_slug ON public.news_articles USING btree (slug);
