-- Index: idx_news_articles_sort

CREATE INDEX idx_news_articles_sort ON public.news_articles USING btree (sort_order, published_at DESC NULLS LAST);
