-- Trigger: update_product_vouchers_updated_at
-- Table: product_vouchers

CREATE TRIGGER update_product_vouchers_updated_at
  BEFORE UPDATE ON public.product_vouchers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
