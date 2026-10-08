-- Policy: knowledge_items_admin_read ON public.knowledge_items
--
-- Správa čte napřímo VŠECHNY položky — i neaktivní, soukromé a v karanténě (jinak by je
-- neměl kdo posoudit). Zvláštní politika, ne větev jiné: ať je vidět, že admin je jediný,
-- kdo globální vrstvu čte bez filtru. Proč čtyři politiky: knowledge_items_global_anon_read.sql.
--
-- Predikát na řádku nezávisí → poddotaz (InitPlan): jedno vyhodnocení za dotaz.
DROP POLICY IF EXISTS knowledge_items_admin_read ON public.knowledge_items;
CREATE POLICY knowledge_items_admin_read ON public.knowledge_items
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));
