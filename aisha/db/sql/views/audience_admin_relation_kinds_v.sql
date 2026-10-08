-- View: public.audience_admin_relation_kinds_v
-- JAK JE KOMUNITA PROPOJENÁ — počty vazeb po druhu.
--
-- ⛔ NAMĚŘENO 2026-09-07: v produkci je 462 vazeb v 9 druzích (works_for,
-- role_in a demo druhy) a NIKDE se nedaly spočítat — registr ukazoval vazby
-- jen v detailu JEDNOHO dvojčete. Struktura sítě přitom není vlastnost
-- jednotlivce; je to vlastnost celku a bez souhrnu se o ní nedá mluvit.
CREATE OR REPLACE VIEW public.audience_admin_relation_kinds_v AS
 SELECT r.relation_kind,
    count(*) AS relation_count,
    count(DISTINCT r.source_twin_id) AS from_twins,
    count(DISTINCT r.target_twin_id) AS to_twins,
    count(*) FILTER (WHERE r.valid_to IS NULL) AS open_count,
    min(r.valid_from)::date AS first_at,
    max(r.valid_from)::date AS last_at
   FROM twin_relations r
  GROUP BY 1;

COMMENT ON VIEW public.audience_admin_relation_kinds_v IS
  'Struktura sítě: kolik vazeb kterého druhu, mezi kolika dvojčaty, od kdy.';

-- ⛔ Pohled s právy VLASTNÍKA (bez security_invoker) čte podklad MIMO jeho RLS.
-- Čte se JEN přes DEFINER blokové funkce get_audience_view_*_block (stráž
-- is_admin_or_staff + jmenný prostor audience_admin_*_v). Přímý grant klientské
-- roli tu stráž obcházel přes /rest/v1/ (naměřeno na čisté DB main 0f992f647:
-- authenticated SELECT, u followup_queue/twin_directory i DML z default privileges).
-- REVOKE i z anon/authenticated: na běžící DB žijí explicitní granty z dřívějších
-- bloků heals a z ALTER DEFAULT PRIVILEGES při každém DROP+CREATE pohledu.
-- Třídu hlídá src/tests/db/pohled-s-pravy-vlastnika-bez-klientskeho-grantu.runtime.test.ts.
REVOKE ALL ON public.audience_admin_relation_kinds_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.audience_admin_relation_kinds_v TO service_role;
