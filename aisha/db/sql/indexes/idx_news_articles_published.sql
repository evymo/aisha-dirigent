-- Index: idx_news_articles_published

CREATE INDEX idx_news_articles_published ON public.news_articles USING btree (is_published, published_at DESC NULLS LAST);
