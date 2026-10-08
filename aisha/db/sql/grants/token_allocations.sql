-- Grants: token_allocations

GRANT SELECT ON public.token_allocations TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.token_allocations TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.token_allocations TO service_role;
