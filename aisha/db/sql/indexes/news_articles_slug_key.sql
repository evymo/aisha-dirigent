-- Index: news_articles_slug_key

CREATE UNIQUE INDEX news_articles_slug_key ON public.news_articles USING btree (slug);
