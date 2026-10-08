-- Grants: production_cost_scenarios

GRANT SELECT ON public.production_cost_scenarios TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.production_cost_scenarios TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.production_cost_scenarios TO service_role;
