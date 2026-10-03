-- Index: idx_news_articles_tags
-- GIN index for the && (array overlap) tag filter in get_published_news_articles_filtered.

CREATE INDEX idx_news_articles_tags ON public.news_articles USING gin (tags);
