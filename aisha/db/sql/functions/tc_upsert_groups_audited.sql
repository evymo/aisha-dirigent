-- ============================================================================
-- Source of Truth: tc_upsert_groups_audited
-- Popis: Batch upsert skupin/organizačních jednotek z T-cars (skupinySeznam).
--        Volá svc-tcars. Doplněno 2026-07-25: sync.ts tuto RPC volal, ale
--        v SoT chyběla. Vrací počty inserted/updated.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT
-- Audit: tc_groups.import_completed s počty (bez PII)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tc_upsert_groups_audited(
  p_groups jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service boolean := public.is_service_role();
  v_batch jsonb;
  v_total integer;
  v_updated integer;
  v_inserted integer;
BEGIN
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  IF p_groups IS NULL OR jsonb_typeof(p_groups) <> 'array' THEN
    RAISE EXCEPTION 'p_groups must be a jsonb array';
  END IF;

  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON ((item->>'tc_group_id')::integer) item
    FROM jsonb_array_elements(p_groups) AS item
    WHERE item->>'tc_group_id' IS NOT NULL
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  SELECT count(*) INTO v_updated
  FROM public.tc_groups g
  WHERE g.tc_group_id IN (
    SELECT (item->>'tc_group_id')::integer
    FROM jsonb_array_elements(v_batch) AS item
  );

  INSERT INTO public.tc_groups (
    tc_group_id, name, number, parent_id, leader_id, leader_name,
    cost_center_id, cost_center_name, active, raw_data, last_import_at, updated_at
  )
  SELECT
    (item->>'tc_group_id')::integer,
    item->>'name',
    item->>'number',
    (item->>'parent_id')::integer,
    (item->>'leader_id')::integer,
    item->>'leader_name',
    (item->>'cost_center_id')::integer,
    item->>'cost_center_name',
    COALESCE((item->>'active')::boolean, true),
    item->'raw',
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (tc_group_id) DO UPDATE SET
    name             = EXCLUDED.name,
    number           = EXCLUDED.number,
    parent_id        = EXCLUDED.parent_id,
    leader_id        = EXCLUDED.leader_id,
    leader_name      = EXCLUDED.leader_name,
    cost_center_id   = EXCLUDED.cost_center_id,
    cost_center_name = EXCLUDED.cost_center_name,
    active           = EXCLUDED.active,
    raw_data         = EXCLUDED.raw_data,
    last_import_at   = EXCLUDED.last_import_at,
    updated_at       = now();

  v_inserted := v_total - v_updated;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'tc_groups.import_completed',
    jsonb_build_object('total', v_total, 'inserted', v_inserted, 'updated', v_updated)
  );

  RETURN jsonb_build_object('total', v_total, 'inserted', v_inserted, 'updated', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.tc_upsert_groups_audited(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tc_upsert_groups_audited(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tc_upsert_groups_audited(jsonb) TO service_role;
