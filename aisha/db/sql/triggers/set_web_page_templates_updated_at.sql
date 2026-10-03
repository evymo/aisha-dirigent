-- Trigger: set_web_page_templates_updated_at

CREATE TRIGGER set_web_page_templates_updated_at
  BEFORE UPDATE ON public.web_page_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
