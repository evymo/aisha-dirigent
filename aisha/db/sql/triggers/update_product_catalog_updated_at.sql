-- Trigger: update_product_catalog_updated_at

CREATE TRIGGER update_product_catalog_updated_at
  BEFORE UPDATE ON public.product_catalog
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
