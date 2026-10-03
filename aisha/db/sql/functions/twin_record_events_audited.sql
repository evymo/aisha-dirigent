-- ============================================================================
-- Source of Truth: twin_record_events_audited
-- Popis: Idempotentní batch zápis událostí dvojčat (jízdy, příjezdy,
--        přiřazení, plánované úkoly…). Dedup přes (source, event_type,
--        source_ref): opakovaný import stejného okna aktualizuje ended_at/
--        attrs/časy (zdroje opravují zpětně — vzor wd_rides), neduplikuje.
--        Položky bez source_ref se vkládají bez dedupu (jednorázové události).
--        Adaptér resolvuje twin_id PŘED zápisem (twin_identity_resolve /
--        twin_upsert_entity_audited) — RPC identity neřeší, jen validuje.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT
-- Audit: twin_events.import_completed s počty (bez PII)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.twin_record_events_audited(
  p_events jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service boolean := public.is_service_role();
  v_batch jsonb;
  v_plain jsonb;
  v_total integer;
  v_updated integer := 0;
  v_inserted integer := 0;
BEGIN
  -- Authorization check (FIRST, before any data access)
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  -- Input validation
  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' THEN
    RAISE EXCEPTION 'p_events must be a jsonb array';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_events) AS item
    WHERE item->>'event_type' IS NULL OR btrim(item->>'event_type') = ''
       OR item->>'twin_id' IS NULL
       OR item->>'occurred_at' IS NULL
       OR item->>'source' IS NULL OR btrim(item->>'source') = ''
  ) THEN
    RAISE EXCEPTION 'each event requires event_type, twin_id, occurred_at, source';
  END IF;

  -- Dedup uvnitř dávky podle (source, event_type, source_ref) — poslední výskyt
  -- vyhrává (novější stav v odpovědi zdroje); ON CONFLICT nesmí zasáhnout
  -- stejný řádek dvakrát.
  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON (item->>'source', item->>'event_type', item->>'source_ref') item
    FROM (
      SELECT item, ordinality
      FROM jsonb_array_elements(p_events) WITH ORDINALITY AS e(item, ordinality)
    ) AS ordered
    WHERE item->>'source_ref' IS NOT NULL
    ORDER BY item->>'source', item->>'event_type', item->>'source_ref', ordinality DESC
  ) AS deduped;

  SELECT COALESCE(jsonb_agg(item), '[]'::jsonb) INTO v_plain
  FROM jsonb_array_elements(p_events) AS item
  WHERE item->>'source_ref' IS NULL;

  v_total := jsonb_array_length(v_batch) + jsonb_array_length(v_plain);

  SELECT count(*) INTO v_updated
  FROM public.twin_events e
  JOIN jsonb_array_elements(v_batch) AS item
    ON e.source = item->>'source'
   AND e.event_type = item->>'event_type'
   AND e.source_ref = item->>'source_ref';

  -- Deduplikovatelné události: upsert podle (source, event_type, source_ref)
  INSERT INTO public.twin_events (
    event_type, twin_id, related_twin_id, place_twin_id, story_id,
    occurred_at, ended_at, attrs, source, source_ref
  )
  SELECT
    item->>'event_type',
    (item->>'twin_id')::uuid,
    (item->>'related_twin_id')::uuid,
    (item->>'place_twin_id')::uuid,
    (item->>'story_id')::uuid,
    (item->>'occurred_at')::timestamptz,
    (item->>'ended_at')::timestamptz,
    COALESCE(item->'attrs', '{}'::jsonb),
    item->>'source',
    item->>'source_ref'
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (source, event_type, source_ref) WHERE source_ref IS NOT NULL
  DO UPDATE SET
    twin_id         = EXCLUDED.twin_id,
    related_twin_id = EXCLUDED.related_twin_id,
    place_twin_id   = EXCLUDED.place_twin_id,
    story_id        = COALESCE(EXCLUDED.story_id, public.twin_events.story_id),
    occurred_at     = EXCLUDED.occurred_at,
    ended_at        = EXCLUDED.ended_at,
    attrs           = EXCLUDED.attrs;

  -- Jednorázové události bez source_ref: prostý insert
  INSERT INTO public.twin_events (
    event_type, twin_id, related_twin_id, place_twin_id, story_id,
    occurred_at, ended_at, attrs, source
  )
  SELECT
    item->>'event_type',
    (item->>'twin_id')::uuid,
    (item->>'related_twin_id')::uuid,
    (item->>'place_twin_id')::uuid,
    (item->>'story_id')::uuid,
    (item->>'occurred_at')::timestamptz,
    (item->>'ended_at')::timestamptz,
    COALESCE(item->'attrs', '{}'::jsonb),
    item->>'source'
  FROM jsonb_array_elements(v_plain) AS item;

  v_inserted := v_total - v_updated;

  -- Audit log
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'twin_events.import_completed',
    jsonb_build_object(
      'total', v_total,
      'inserted', v_inserted,
      'updated', v_updated
    )
  );

  RETURN jsonb_build_object(
    'total', v_total,
    'inserted', v_inserted,
    'updated', v_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.twin_record_events_audited(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.twin_record_events_audited(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.twin_record_events_audited(jsonb) TO service_role;
