-- Trigger: update_member_products_updated_at

CREATE TRIGGER update_member_products_updated_at
  BEFORE UPDATE ON public.member_products
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
