-- ============================================================================
-- Source of Truth: get_news_timeline_block
-- Popis: GENERICKÝ 'timeline' blok nad publikovanými články (news_articles):
--        jedna položka = jeden článek, `at` = published_at, `label_key` =
--        title_key (překlad řeší klient, hlavička je v šesti jazycích).
--
-- ⛔ PROČ VZNIKL (naměřeno 2026-09-03, audit U4-3): sekce „oznámení" extranetu
-- byla v seedu napojená na get_workflow_timeline_block — časovou osu VÝROBNÍHO
-- workflow, která navíc vrací tvar TABULKY (columns/rows), zatímco blok byl
-- deklarovaný jako `timeline` (items). Ajv ho odmítl a sekce ukazovala jen
-- banner „Některé bloky se nepodařilo zobrazit". Oznámení komunity jsou
-- publikované články — tenhle blok je vydá ve tvaru, který timeline čeká.
--
-- Konfigurace (p_params):
--   limit   volitelné  default 20, strop 100
--   tag     volitelné  jen články, jejichž `tags` (text[]) obsahují PRÁVĚ
--                      tenhle štítek jako prvek (ne podřetězec)
--
-- Bezpečnost: SECURITY INVOKER — čte přes RLS volajícího; publikované články
-- jsou veřejné i na webu, takže blok nic neodkrývá. Prázdno je poctivé prázdno:
-- `items: []` s provenance, žádná výjimka.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_news_timeline_block(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  with cfg as (
    select
      least(greatest(coalesce((p_params->>'limit')::int, 20), 1), 100) as lim,
      nullif(trim(p_params->>'tag'), '')                               as tag
  ),
  vybrane as (
    select n.title_key, n.published_at, n.slug
    from public.news_articles n, cfg
    where n.is_published
      and n.published_at is not null
      -- ⛔ `tags` je text[], ne text. Řetězcové `ilike` na poli operátor nemá
      -- a CREATE FUNCTION selže UŽ PŘI VYTVOŘENÍ (check_function_bodies),
      -- takže spadne celý heals.sql a s ním krok migrace — naměřeno
      -- 2026-09-04: `core` se nenasadil a API leželo na 502.
      -- Štítek je PRVEK pole, ne podřetězec; rovnost je i pravdivější:
      -- 'novinky' by jinak potichu chytalo i 'novinkytest'.
      and (cfg.tag is null or cfg.tag = any(n.tags))
    order by n.published_at desc
    limit (select lim from cfg)
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'items', coalesce(
        (select jsonb_agg(jsonb_build_object(
            'at',        to_char(v.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'label_key', v.title_key)
          order by v.published_at desc)
         from vybrane v),
        '[]'::jsonb)),
    'provenance', jsonb_build_object(
      'source_slug',  'news_articles',
      'trace_id',     'news:timeline',
      'freshness_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  );
$$;

REVOKE ALL ON FUNCTION public.get_news_timeline_block(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_news_timeline_block(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_news_timeline_block(jsonb) TO service_role;
