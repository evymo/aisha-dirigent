-- Grants: onboarding_responses

GRANT SELECT ON public.onboarding_responses TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.onboarding_responses TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.onboarding_responses TO service_role;
