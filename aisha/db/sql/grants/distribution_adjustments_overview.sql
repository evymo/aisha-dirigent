-- Grants: distribution_adjustments_overview
--
-- ⛔ Pohled s právy VLASTNÍKA (úpravy dávkování členů (member_token, poznámka konzultanta, e-mail autorizujícího)) — mimo RLS podkladu. Do 2026-10-04 měl
-- SELECT pro anon a plné DML pro authenticated, takže šel číst přes /rest/v1/
-- i bez přihlášení. Klient ho přímo nečte (studijní souhrny vydávají DEFINER
-- funkce get_study_cohort_*_secure se strážemi); zůstává jen služba. REVOKE ALL
-- napřed: na běžící DB žijí i granty z ALTER DEFAULT PRIVILEGES.
REVOKE ALL ON public.distribution_adjustments_overview FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.distribution_adjustments_overview TO service_role;
