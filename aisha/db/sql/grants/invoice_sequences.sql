-- Grants: invoice_sequences

GRANT SELECT ON public.invoice_sequences TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.invoice_sequences TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.invoice_sequences TO service_role;
