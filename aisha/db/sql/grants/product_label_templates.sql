-- Grants: product_label_templates

GRANT SELECT ON public.product_label_templates TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.product_label_templates TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.product_label_templates TO service_role;
