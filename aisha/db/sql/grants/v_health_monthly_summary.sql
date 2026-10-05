-- Grants: v_health_monthly_summary
--
-- Jen čtení, jen přihlášeným a službě. Dřív SELECT pro anon a plné DML pro
-- authenticated — nad pohledem s právy vlastníka to byl únik zdravotních dat
-- bez přihlášení. REVOKE ALL napřed: na běžící DB žijí i granty z ALTER DEFAULT
-- PRIVILEGES, které samotný GRANT nezruší.
REVOKE ALL ON public.v_health_monthly_summary FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_health_monthly_summary TO authenticated, service_role;
