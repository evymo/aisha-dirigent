-- ============================================================================
-- Source of Truth: canonical_ingest_source
-- Popis: Kanonická identita zdroje, pod kterou se zapisují vazby twinů.
--        Zdroj POHLCENÝ jiným (agent_knowledge_sources: neaktivní +
--        config.superseded_by) se převede na toho, kdo ho pohltil.
-- Bezpečnost: SECURITY INVOKER, bez grantu klientům — volají ji jen zapisovatelé
--             twinů (SECURITY DEFINER) zevnitř, takže běží jejich právy.
--
-- ⛔ PROČ VZNIKLA (naměřeno 2026-09-19 v produkci riq). Tři balíčky ze 3.–4. 8.
--    nesly jméno aplikace `aisha-local-ingest` místo registrovaného zdroje
--    `local-ingest`. V registru zdrojů se to 2026-09-02 sjednotilo pohlcením
--    (ensure_source_story, config.superseded_by) — ale zapisovatelé twinů
--    párují PŘESNĚ podle (source, source_key), takže přehrání 30. 8. založilo
--    839 duplikátních firem (21 % všech twinů). Jedna skutečnost, DVĚ identity.
--    Pohlcení je kurátorované rozhodnutí o světě; tady se jen DODRŽUJE i pro
--    twiny — nové rozhodnutí se tu nevyrábí.
--
-- Kontrakt: (text) -> text  (nepohlcený nebo neznámý zdroj vrací beze změny)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.canonical_ingest_source(p_source text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce(
    (SELECT btrim(s.config ->> 'superseded_by')
       FROM public.agent_knowledge_sources s
      WHERE s.source_slug = p_source
        AND NOT s.is_active
        AND coalesce(btrim(s.config ->> 'superseded_by'), '') <> ''
      LIMIT 1),
    p_source);
$function$;

REVOKE ALL ON FUNCTION public.canonical_ingest_source(text) FROM PUBLIC, anon, authenticated;
