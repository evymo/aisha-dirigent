-- ============================================================================
-- Source of Truth: expert_rule_visible_to
-- Popis: Smí publikum vidět expertní pravidlo? JEDINÉ místo, kudy čtenáři tabulky expert_rules
--        (definer funkce) měří viditelnost — pravidlo samo nenese, ptá se domova
--        public.knowledge_visibility_searchable (štítek znamená u pravidel totéž co u znalostí:
--        public každý, members přihlášený, guild gilda, private správa) a „je v gildě“ bere
--        z public.knowledge_audience_in_guild.
--
--   správa (admin/staff)         vše
--   autor pravidla               své pravidlo s jakoukoli viditelností
--   ostatní                      podle domova viditelnosti
--
-- Stav (published / draft) měří volající — autor smí číst svůj koncept, ostatní jen publikované.
-- p_audience_user_id = PRO KOHO se čte: volající ho připíná (jen služba smí jmenovat publikum,
-- přihlášený je on sám, bez identity NULL → jen `public`). Brána znalosti-viditelnost-kazda-cesta
-- drží, že každý příkaz, který čte expert_rules v čtenáři obsahu, volá tuhle funkci.
--
-- Zavedeno 2026-10-05 (revize B1): detail pravidla vydal anonymovi tělo i pokyny pravidla s jakoukoli
-- viditelností; 20+ dalších čtenářů (rulesety příběhu, compliance, agenti, copilot instrukce) viditelnost
-- nečetlo vůbec a create_story_ruleset přijme do rulesetu jakékoli publikované pravidlo podle id.
-- Volá se na řádek (tabulka pravidel je malá); rolím API se nevydává.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.expert_rule_visible_to(p_visibility text, p_author_partner_id uuid, p_audience_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
  -- Bez publika (NULL) = bez identity: is_admin_or_staff(NULL) by se ptal na auth.uid() volajícího, takže
  -- správa volající veřejný výstup (publikum NULL) by dostala i soukromá pravidla — proto jen s publikem.
  SELECT (p_audience_user_id IS NOT NULL AND COALESCE(public.is_admin_or_staff(p_audience_user_id), false))
      OR (p_audience_user_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.partner_profiles pp
                       WHERE pp.id = p_author_partner_id AND pp.user_id = p_audience_user_id))
      OR public.knowledge_visibility_searchable(
           p_visibility, p_audience_user_id IS NOT NULL, public.knowledge_audience_in_guild(p_audience_user_id))
$$;

REVOKE ALL ON FUNCTION public.expert_rule_visible_to(text, uuid, uuid) FROM PUBLIC;
