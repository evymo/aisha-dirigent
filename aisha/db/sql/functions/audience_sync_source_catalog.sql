-- ============================================================================
-- Source of Truth: audience_sync_source_catalog
-- Popis: Přelije jednu dávku katalogu zdroje (listCatalog adaptéru) do
--        source_catalog_rows. Volá jen svc-source-broker pod service_role.
--
-- Režimy (SourceCatalogMode, packages/audience-types):
--   snapshot  dávka = CELÁ množina. Upsert + smazání řádků (zdroj, druh), které
--             v dávce nejsou — co ve zdroji zmizelo, zmizí i tady.
--   series    dávka = přírůstek. Jen upsert, starší řádky zůstávají (historie,
--             kterou zdroj sám nedrží — např. denní snímky KPI).
--
-- ⛔ PRÁZDNÁ DÁVKA NEVYMAŽE NEPRÁZDNÝ SNAPSHOT (p_allow_empty=false). Adaptér
-- při chybě vyhazuje, ale oříznutý / prázdný výsledek ze špatně nastavené role
-- nebo prázdné repliky by jinak smazal dobrá data. Vrátí se `refused_empty`
-- a broker to zaloguje; vědomé vyprázdnění = p_allow_empty=true.
--
-- Vstup p_rows = jsonb pole SourceCatalogRow v camelCase:
--   [{"externalId": "…", "occurredAt": "ISO|null", "fields": {…skaláry…}}]
-- Duplicitní externalId v jedné dávce vyhraje POSLEDNÍ výskyt.
-- Výstup: {"kind","mode","upserted","removed","refused_empty"}.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.audience_sync_source_catalog(
  p_source_slug text,
  p_kind text,
  p_mode text,
  p_rows jsonb,
  p_allow_empty boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_upserted int := 0;
  v_removed  int := 0;
  v_existing int := 0;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'audience_sync_source_catalog: service role only' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_source_slug, '') = '' THEN
    RAISE EXCEPTION 'audience_sync_source_catalog: source_slug is required' USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NULL OR p_kind !~ '^[a-z][a-z0-9_]{1,39}$' THEN
    RAISE EXCEPTION 'audience_sync_source_catalog: kind must match ^[a-z][a-z0-9_]{1,39}$ (got %)', p_kind
      USING ERRCODE = '22023';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('snapshot', 'series') THEN
    RAISE EXCEPTION 'audience_sync_source_catalog: mode must be snapshot|series (got %)', p_mode
      USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'audience_sync_source_catalog: rows must be a json array' USING ERRCODE = '22023';
  END IF;
  -- Řádek bez identity nebo s vnořeným polem je vadný adaptér — odmítne se CELÁ
  -- dávka, ne jen řádek: u snapshotu by vynechaný řádek znamenal smazání.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) r
     WHERE coalesce(r->>'externalId', '') = ''
        OR (r ? 'fields' AND jsonb_typeof(r->'fields') <> 'object')
        OR EXISTS (SELECT 1 FROM jsonb_each(coalesce(r->'fields', '{}'::jsonb)) f
                    WHERE jsonb_typeof(f.value) IN ('object', 'array'))
  ) THEN
    RAISE EXCEPTION 'audience_sync_source_catalog: every row needs externalId and scalar fields (kind %)', p_kind
      USING ERRCODE = '22023';
  END IF;

  IF p_mode = 'snapshot' AND jsonb_array_length(p_rows) = 0 AND NOT coalesce(p_allow_empty, false) THEN
    SELECT count(*) INTO v_existing FROM public.source_catalog_rows
     WHERE source_slug = p_source_slug AND kind = p_kind;
    IF v_existing > 0 THEN
      RETURN jsonb_build_object('kind', p_kind, 'mode', p_mode,
        'upserted', 0, 'removed', 0, 'refused_empty', true);
    END IF;
  END IF;

  WITH davka AS (
    SELECT DISTINCT ON (r->>'externalId')
           r->>'externalId' AS external_id,
           nullif(r->>'occurredAt', '')::timestamptz AS occurred_at,
           coalesce(r->'fields', '{}'::jsonb) AS fields
      FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(r, ord)
     ORDER BY r->>'externalId', ord DESC
  ), zapsano AS (
    INSERT INTO public.source_catalog_rows AS c
      (source_slug, kind, external_id, occurred_at, fields, first_seen_at, synced_at)
    SELECT p_source_slug, p_kind, d.external_id, d.occurred_at, d.fields, now(), now()
      FROM davka d
    ON CONFLICT (source_slug, kind, external_id) DO UPDATE SET
      occurred_at = EXCLUDED.occurred_at,
      fields      = EXCLUDED.fields,
      synced_at   = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_upserted FROM zapsano;

  IF p_mode = 'snapshot' THEN
    WITH smazano AS (
      DELETE FROM public.source_catalog_rows c
       WHERE c.source_slug = p_source_slug
         AND c.kind = p_kind
         -- NOT IN nad poddotazem = hashovaný subplan (jedno sestavení množiny),
         -- ne průchod dávkou pro každý řádek. NULL v dávce být nemůže (ověřeno výš).
         AND c.external_id NOT IN (SELECT r->>'externalId' FROM jsonb_array_elements(p_rows) r)
      RETURNING 1
    )
    SELECT count(*) INTO v_removed FROM smazano;
  END IF;

  RETURN jsonb_build_object('kind', p_kind, 'mode', p_mode,
    'upserted', v_upserted, 'removed', v_removed, 'refused_empty', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.audience_sync_source_catalog(text, text, text, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audience_sync_source_catalog(text, text, text, jsonb, boolean) TO service_role;
