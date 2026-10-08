-- Grants: distribution_adjustments_overview
--
-- ⛔ Pohled s právy VLASTNÍKA (bez security_invoker) — čte podklad MIMO jeho RLS
-- a vydává úpravy dávkování členů včetně poznámky a e-mailu autorizujícího. Do 2026-10-06 měl SELECT pro anon a plné DML pro authenticated:
-- naměřeno na čisté DB main 0f992f647 (baseline + heals) — čitelný přes /rest/v1/
-- i bez přihlášení. Změřeno 2026-10-06: přímo ho nečte žádný klient v repu (web,
-- mobil, služby, n8n); čtou ho nanejvýš SECURITY DEFINER funkce se strážemi
-- (get_study_cohort_*_secure), které běží právy vlastníka — zůstává jen službě.
-- REVOKE napřed: na běžící DB žijí i granty z dřívějška a z ALTER DEFAULT PRIVILEGES,
-- které samotný GRANT nezruší. Třídu hlídá
-- src/tests/db/pohled-s-pravy-vlastnika-bez-klientskeho-grantu.runtime.test.ts.
REVOKE ALL ON public.distribution_adjustments_overview FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.distribution_adjustments_overview TO service_role;
