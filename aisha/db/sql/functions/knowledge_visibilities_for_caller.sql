-- ============================================================================
-- Source of Truth: knowledge_visibilities_for_caller
-- Popis: Viditelnosti, které smí VOLAJÍCÍ číst napřímo — pomocník politik tabulek knowledge_items
--        a expert_rules (čtení přes PostgREST). Pravidlo NENESE: pro identitu volajícího (auth.uid(),
--        gilda z knowledge_audience_in_guild) se zeptá jediného domova knowledge_visibility_searchable
--        na každý štítek, který domov kdy povolí.
--
-- Proč množina a ne volání na řádek: politika s funkcí na řádku stála čtení napřímo ~100× víc
-- (revize 2026-10-05: count přímo z tabulky 809 ms proti 7 ms). Tady se množina spočítá JEDNOU za
-- dotaz (politika ji volá v poddotazu bez vazby na řádek → InitPlan) a na řádku zbude `= ANY(…)`.
--
-- Výčet kandidátů ('public', 'members', 'guild') NENÍ pravidlo — jsou to štítky, které domov kdy
-- povolí (větve WHEN … THEN true / COALESCE(…)). Brána znalosti-viditelnost-jeden-domov drží, že se
-- shodují se štítky v domově; štítek přidaný jen do domova by napřímo neviděl nikdo (fail-closed)
-- a brána spadne.
--
-- SECURITY DEFINER: čte partner_profiles bez ohledu na politiky volajícího a politika ji volá
-- právy tazatele (anon, authenticated). Vrací jen množinu štítků o volajícím samém — za nikoho
-- jiného se zeptat nejde (nemá parametr).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.knowledge_visibilities_for_caller()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
  SELECT coalesce(array_agg(v ORDER BY v), '{}'::text[])
    FROM unnest(ARRAY['public', 'members', 'guild']::text[]) AS v
   WHERE public.knowledge_visibility_searchable(v, auth.uid() IS NOT NULL, public.knowledge_audience_in_guild(auth.uid()))
$$;

REVOKE ALL ON FUNCTION public.knowledge_visibilities_for_caller() FROM PUBLIC;
-- Volají ji politiky tabulek knowledge_items a expert_rules právy tazatele.
GRANT EXECUTE ON FUNCTION public.knowledge_visibilities_for_caller() TO anon;
GRANT EXECUTE ON FUNCTION public.knowledge_visibilities_for_caller() TO authenticated;
GRANT EXECUTE ON FUNCTION public.knowledge_visibilities_for_caller() TO service_role;
