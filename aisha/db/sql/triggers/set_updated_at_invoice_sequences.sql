-- Trigger: set_updated_at_invoice_sequences

CREATE TRIGGER set_updated_at_invoice_sequences
  BEFORE UPDATE ON public.invoice_sequences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
