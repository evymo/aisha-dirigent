-- Grants: member_product_plans

GRANT SELECT ON public.member_product_plans TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.member_product_plans TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.member_product_plans TO service_role;
