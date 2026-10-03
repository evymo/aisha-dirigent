-- Index: idx_news_deliveries_user

CREATE INDEX idx_news_deliveries_user ON public.news_article_deliveries USING btree (user_id, news_article_id);
