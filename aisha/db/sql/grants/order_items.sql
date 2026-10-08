-- Grants: order_items

GRANT SELECT ON public.order_items TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.order_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.order_items TO service_role;
