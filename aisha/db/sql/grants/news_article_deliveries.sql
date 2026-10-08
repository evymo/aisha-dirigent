-- Grants: news_article_deliveries

GRANT SELECT ON public.news_article_deliveries TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.news_article_deliveries TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.news_article_deliveries TO service_role;
