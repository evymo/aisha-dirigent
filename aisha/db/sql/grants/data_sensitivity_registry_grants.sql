-- Grants: data_sensitivity_registry
-- authenticated reads (RLS further restricts); service_role manages (seed + the
-- SECURITY DEFINER reader run as service_role / definer-owner).
GRANT SELECT ON public.data_sensitivity_registry TO authenticated;
GRANT ALL ON public.data_sensitivity_registry TO service_role;
