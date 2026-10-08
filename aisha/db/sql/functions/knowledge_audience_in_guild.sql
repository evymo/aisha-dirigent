-- ============================================================================
-- Source of Truth: knowledge_audience_in_guild
-- Popis: JEDEN domov definice „je v gildě“ pro viditelnost `guild` (znalosti i expertní pravidla).
--        Domov viditelnosti (knowledge_visibility_searchable) dostává tuto pravdivostní hodnotu jako
--        vstup; každá cesta čtení ji počítá TADY, ne vlastním EXISTS. Brána
--        znalosti-viditelnost-kazda-cesta drží, že čtenáři volají tohle a nic jiného.
--
-- DEFINICE (rozhodnutí majitele 2026-10-05, varianta G1): členem gildy je, kdo byl PŘIJAT do studie
-- (původní „cluster“) a PROŠEL TESTY:
--   · přijat  = má schválené konzultantství ve studii — study_consultants.status = 'approved' pro jeho
--               profil partnera (schvaluje správa; politika Admin_can_manage_consultants);
--   · prošel  = partner_profiles.is_certified — sloupec řízený serverem (trigger
--               guard_partner_profile_privilege_columns: měnit ho smí jen správa).
-- Globálně, bez vazby na konkrétní studii (znalost ani pravidlo vazbu na studii nemají).
-- NEPOUŽÍVÁ se samoobslužné: řádek partner_profiles sám (založí si ho kdokoli přihlášený —
-- do 2026-10-05 to byla celá definice, takže `guild` byl fakticky `members`), guild_tier ani
-- certification_passed_at (vlastník je přepíše přes politiku „Users can update own partner profile“).
--
-- Bez identity (NULL) false. Čte tabulku → STABLE, právy vlastníka volajících definer funkcí;
-- rolím API se nevydává (politiky tabulek volají knowledge_visibilities_for_caller).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.knowledge_audience_in_guild(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
  SELECT p_user_id IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.partner_profiles pp
         JOIN public.study_consultants sc ON sc.partner_id = pp.id AND sc.status = 'approved'
        WHERE pp.user_id = p_user_id
          AND pp.is_certified IS TRUE
     )
$$;

-- Není to RPC: volají ji definer funkce (právy vlastníka) a pomocník politik.
REVOKE ALL ON FUNCTION public.knowledge_audience_in_guild(uuid) FROM PUBLIC;
