-- Grants: longevity_scores

GRANT SELECT ON public.longevity_scores TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.longevity_scores TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.longevity_scores TO service_role;
