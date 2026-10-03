-- Trigger: set_news_article_versions_updated_at
-- Koncept (kind='draft') se přepisuje při každém uložení; updated_at nese razítko
-- souběhu (news_article_edit_stamp), proto ho drží trigger jako u news_articles.

DROP TRIGGER IF EXISTS set_news_article_versions_updated_at ON public.news_article_versions;
CREATE TRIGGER set_news_article_versions_updated_at
  BEFORE UPDATE ON public.news_article_versions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
