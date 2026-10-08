-- Policies for expert_rules table (čtení napřímo přes PostgREST)
--
-- Viditelnost rozhoduje JEDEN domov (public.knowledge_visibility_searchable) — týž jako u znalostí;
-- politika se ho ptá přes množinu public.knowledge_visibilities_for_caller() (spočítá se jednou za
-- dotaz z identity volajícího): anonym jen `public`, přihlášený navíc `members`, gilda (G1) `guild`.
-- Do 2026-10-05 tu stály vlastní výčty ('public') / ('public', 'members'). Soukromá pravidla, koncepty
-- a cizí koncepty napřímo nikdo; autor a správa čtou přes funkce (get_expert_rule_detail, …).
-- Přehrává heals.sql — politiky dřív do běžících databází nedotekly vůbec.

DROP POLICY IF EXISTS anon_read_public_rules ON public.expert_rules;
CREATE POLICY anon_read_public_rules ON public.expert_rules
  AS PERMISSIVE FOR SELECT TO anon
  USING (
    status = 'published'
    AND visibility = ANY ((SELECT public.knowledge_visibilities_for_caller())::text[])
  );

DROP POLICY IF EXISTS auth_read_public_and_members_rules ON public.expert_rules;
CREATE POLICY auth_read_public_and_members_rules ON public.expert_rules
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    status = 'published'
    AND visibility = ANY ((SELECT public.knowledge_visibilities_for_caller())::text[])
  );

DROP POLICY IF EXISTS service_role_full_access_rules ON public.expert_rules;
CREATE POLICY service_role_full_access_rules ON public.expert_rules
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
