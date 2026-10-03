-- ============================================================================
-- Source of Truth: audience_record_block_empty
-- Popis: Prázdný, tvarově platný 'record_detail' blok s důvodem v trace_id.
--   Pomocník pro get_audience_view_record_block — poctivá degradace na jednom
--   místě (bez práv / bez konfigurace / bez identity / řádek nenalezen).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.audience_record_block_empty(p_view text, p_reason text, p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'data', jsonb_build_object('record_id', NULL, 'badges', '[]'::jsonb, 'fields', '[]'::jsonb),
    'provenance', jsonb_build_object(
      'source_slug', coalesce(p_view, 'audience'),
      'trace_id', 'audience-record:' || coalesce(p_reason, 'empty'),
      'freshness_at', p_now));
$$;

REVOKE ALL ON FUNCTION public.audience_record_block_empty(text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audience_record_block_empty(text, text, timestamptz) TO authenticated, service_role;
