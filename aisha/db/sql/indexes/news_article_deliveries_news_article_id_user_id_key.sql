-- Index: news_article_deliveries_news_article_id_user_id_key

CREATE UNIQUE INDEX news_article_deliveries_news_article_id_user_id_key ON public.news_article_deliveries USING btree (news_article_id, user_id);
