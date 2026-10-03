-- Table privileges for public.twin_relation_proposals.
--
-- Týž tvar jako twin_external_refs: RLS rozhoduje, KTERÉ řádky volající vidí,
-- ale Postgres kontroluje oprávnění k tabulce DŘÍV — bez SELECT grantu by
-- SECURITY INVOKER fronta (get_twin_relation_proposal_queue) skončila na
-- „permission denied", ne na prázdném výsledku.
--
-- Zápis jen service_role / definer RPC (twin_relation_propose,
-- twin_relation_proposal_decide). Výchozí oprávnění schématu dávají
-- authenticated i INSERT/UPDATE/DELETE; RLS je sice zastaví (žádná zápisová
-- policy), ale nárok, který nikdo nemá používat, se nemá ani držet — stejný
-- úklid jako u twin_relations.
GRANT SELECT ON public.twin_relation_proposals TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.twin_relation_proposals FROM authenticated;
REVOKE ALL ON public.twin_relation_proposals FROM anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.twin_relation_proposals TO service_role;
