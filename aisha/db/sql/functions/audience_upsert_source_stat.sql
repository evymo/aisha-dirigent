-- ============================================================================
-- Source of Truth: audience_upsert_source_stat
-- Popis: Uloží/aktualizuje jeden řádek měsíční statistiky zdroje (téma nebo
--        událost vzniklá v daném měsíci), jak ji doručil svc-source-broker
--        z adaptéru (listStats). Idempotentní na (zdroj, druh, měsíc, id).
-- Bezpečnost: SECURITY DEFINER; volá jen broker pod service_role. Vstup je
--        jsonb v camelCase tvaru StatRow (packages/audience-types), NE sloupce —
--        tak se řádek nerozbije, když adaptér přidá pole, které tabulka nezná.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.audience_upsert_source_stat(
  p_kind text, p_month text, p_external_id text, p_row jsonb, p_source_slug text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'audience_upsert_source_stat: service role only' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('topic', 'event') THEN
    RAISE EXCEPTION 'audience_upsert_source_stat: kind must be topic|event (got %)', p_kind USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.source_period_stats (
    source_slug, kind, month, external_id, title, created_by, created_by_id, created_at, date_from, date_to,
    deleted, is_private, official, cancelled, online, follow_count, posts_count, tags, synced_at
  ) VALUES (
    p_source_slug, p_kind, p_month, p_external_id,
    coalesce(p_row->>'title', ''),
    coalesce(p_row->>'createdBy', ''),
    coalesce(p_row->>'createdById', ''),
    nullif(p_row->>'createdAt', '')::timestamptz,
    nullif(p_row->>'dateFrom', '')::timestamptz,
    nullif(p_row->>'dateTo', '')::timestamptz,
    coalesce((p_row->>'deleted')::boolean, false),
    coalesce((p_row->>'private')::boolean, false),
    coalesce((p_row->>'official')::boolean, false),
    coalesce((p_row->>'cancelled')::boolean, false),
    coalesce((p_row->>'online')::boolean, false),
    coalesce((p_row->>'followCount')::int, 0),
    coalesce((p_row->>'postsCount')::int, 0),
    coalesce(p_row->>'tags', ''),
    now()
  )
  ON CONFLICT (source_slug, kind, month, external_id) DO UPDATE SET
    title = EXCLUDED.title, created_by = EXCLUDED.created_by,
    created_by_id = EXCLUDED.created_by_id, created_at = EXCLUDED.created_at,
    date_from = EXCLUDED.date_from, date_to = EXCLUDED.date_to,
    deleted = EXCLUDED.deleted, is_private = EXCLUDED.is_private, official = EXCLUDED.official,
    cancelled = EXCLUDED.cancelled, online = EXCLUDED.online,
    follow_count = EXCLUDED.follow_count, posts_count = EXCLUDED.posts_count, tags = EXCLUDED.tags,
    synced_at = now();
END;
$function$;
REVOKE ALL ON FUNCTION public.audience_upsert_source_stat(text, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audience_upsert_source_stat(text, text, text, jsonb, text) TO service_role;
