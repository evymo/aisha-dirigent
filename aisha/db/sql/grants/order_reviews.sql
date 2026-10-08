-- Grants: order_reviews

GRANT SELECT ON public.order_reviews TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.order_reviews TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.order_reviews TO service_role;
