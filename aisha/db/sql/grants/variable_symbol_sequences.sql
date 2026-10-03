-- Grants: variable_symbol_sequences

GRANT SELECT ON public.variable_symbol_sequences TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.variable_symbol_sequences TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.variable_symbol_sequences TO service_role;
