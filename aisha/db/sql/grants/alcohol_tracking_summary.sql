-- Grants: alcohol_tracking_summary

GRANT SELECT ON public.alcohol_tracking_summary TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.alcohol_tracking_summary TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.alcohol_tracking_summary TO service_role;
