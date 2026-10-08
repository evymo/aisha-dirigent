-- Trigger: set_web_page_versions_updated_at
-- Koncept (kind='draft') se přepisuje při každém uložení; updated_at nese razítko
-- souběhu (web_page_edit_stamp), proto ho drží trigger jako u web_pages.

DROP TRIGGER IF EXISTS set_web_page_versions_updated_at ON public.web_page_versions;
CREATE TRIGGER set_web_page_versions_updated_at
  BEFORE UPDATE ON public.web_page_versions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
