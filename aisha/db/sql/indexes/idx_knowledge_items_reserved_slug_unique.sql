-- Index: idx_knowledge_items_reserved_slug_unique
--
-- Vyhrazený jmenný prostor znalostí ze zkušenosti: položky, které zapisuje jen seed
-- z repozitáře (source_type 'platform_knowledge' — platforma, 'instance_knowledge' —
-- datové repo instance). Slug je jedinečný na locale UVNITŘ každé vrstvy. Každá vrstva
-- má vlastní id (md5('ki-' || source_type || ':' || slug)), takže táž položka ve dvou
-- vrstvách jsou dva řádky, nikdy jeden, který by si vrstvy při každém nasazení přepisovaly.
-- Generátor vrstvy instance slug platformy odmítne už při psaní.
--
-- Proč zvlášť a ne v idx_knowledge_items_source_slug_locale_unique: globální index nad
-- (source_slug, locale) by dovolil komukoli, kdo smí založit položku se slugem (téma,
-- pravidlo expertů, položka příběhu), obsadit slug, který platforma přidá v příští verzi
-- — a seed by pak při nasazení narazil na unikátní index a shodil Core. Globální index
-- proto vyhrazené typy vynechává a jejich jedinečnost drží tento. Zápis vyhrazených typů
-- koncovým uživatelem odmítá trg_protect_reserved_knowledge.
--
-- DROP první kvůli idempotenci (baseline + \ir v heals.sql).
DROP INDEX IF EXISTS public.idx_knowledge_items_reserved_slug_unique;
CREATE UNIQUE INDEX idx_knowledge_items_reserved_slug_unique
  ON public.knowledge_items USING btree (source_type, source_slug, locale)
  WHERE (source_type = ANY (ARRAY['platform_knowledge'::text, 'instance_knowledge'::text]));
