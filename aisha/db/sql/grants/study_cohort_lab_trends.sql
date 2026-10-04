-- Grants: study_cohort_lab_trends
--
-- ⛔ Pohled s právy VLASTNÍKA (měsíční průměry laboratorních výsledků kohort studií) — mimo RLS podkladu. Do 2026-10-04 měl
-- SELECT pro anon a plné DML pro authenticated, takže šel číst přes /rest/v1/
-- i bez přihlášení. Klient ho přímo nečte (studijní souhrny vydávají DEFINER
-- funkce get_study_cohort_*_secure se strážemi); zůstává jen služba. REVOKE ALL
-- napřed: na běžící DB žijí i granty z ALTER DEFAULT PRIVILEGES.
REVOKE ALL ON public.study_cohort_lab_trends FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.study_cohort_lab_trends TO service_role;
