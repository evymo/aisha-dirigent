-- Grants: v_health_weekly_summary
--
-- Jen čtení a jen přihlášeným a službě; pohled je security_invoker, takže
-- přihlášený vidí jen řádky, které mu dovolí RLS podkladu (health_check_ins).
-- Do 2026-10-06 tu byl SELECT pro anon a plné DML pro authenticated nad pohledem
-- s právy vlastníka = čtení řádků všech vlastníků bez přihlášení (naměřeno na čisté
-- DB main 0f992f647). REVOKE napřed: na běžící DB žijí i granty z dřívějška
-- a z ALTER DEFAULT PRIVILEGES, které samotný GRANT nezruší.
REVOKE ALL ON public.v_health_weekly_summary FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_health_weekly_summary TO authenticated, service_role;
