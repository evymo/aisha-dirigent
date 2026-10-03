-- Index: idx_news_deliveries_article

CREATE INDEX idx_news_deliveries_article ON public.news_article_deliveries USING btree (news_article_id);
