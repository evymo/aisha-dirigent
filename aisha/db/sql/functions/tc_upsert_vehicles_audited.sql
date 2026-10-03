-- ============================================================================
-- Source of Truth: tc_upsert_vehicles_audited
-- Popis: Batch upsert vozidel/strojů z T-cars. Volá svc-tcars po stažení
--        vozidlaSeznam. Vozidla se nikdy nemažou — deaktivace přijde z API
--        přes pole active. Vrací počty inserted/updated.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT
-- Audit: tc_vehicles.import_completed s počty (bez PII)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tc_upsert_vehicles_audited(
  p_vehicles jsonb
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
  -- Authorization check (FIRST, before any data access)
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  -- Input validation
  IF p_vehicles IS NULL OR jsonb_typeof(p_vehicles) <> 'array' THEN
    RAISE EXCEPTION 'p_vehicles must be a jsonb array';
  END IF;

  -- Dedup podle tc_vehicle_id — ON CONFLICT nesmí zasáhnout stejný řádek dvakrát
  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON ((item->>'tc_vehicle_id')::integer) item
    FROM jsonb_array_elements(p_vehicles) AS item
    WHERE item->>'tc_vehicle_id' IS NOT NULL
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  SELECT count(*) INTO v_updated
  FROM public.tc_vehicles v
  WHERE v.tc_vehicle_id IN (
    SELECT (item->>'tc_vehicle_id')::integer
    FROM jsonb_array_elements(v_batch) AS item
  );

  INSERT INTO public.tc_vehicles (
    tc_vehicle_id, model, plate, evidence_no, unit_no,
    group_id, group_name, responsible_id, responsible_name, responsible_since,
    cost_center_id, cost_center_name, kind, category, emission_norm,
    fuel_primary, fuel_alt, purchase_price, first_registration, active,
    raw_data, last_import_at, updated_at
  )
  SELECT
    (item->>'tc_vehicle_id')::integer,
    item->>'model',
    item->>'plate',
    item->>'evidence_no',
    item->>'unit_no',
    (item->>'group_id')::integer,
    item->>'group_name',
    (item->>'responsible_id')::integer,
    item->>'responsible_name',
    NULLIF(item->>'responsible_since', '')::date,
    (item->>'cost_center_id')::integer,
    item->>'cost_center_name',
    item->>'kind',
    item->>'category',
    item->>'emission_norm',
    item->>'fuel_primary',
    item->>'fuel_alt',
    (item->>'purchase_price')::numeric,
    NULLIF(item->>'first_registration', '')::date,
    COALESCE((item->>'active')::boolean, true),
    item->'raw',
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (tc_vehicle_id) DO UPDATE SET
    model              = EXCLUDED.model,
    plate              = EXCLUDED.plate,
    evidence_no        = EXCLUDED.evidence_no,
    unit_no            = EXCLUDED.unit_no,
    group_id           = EXCLUDED.group_id,
    group_name         = EXCLUDED.group_name,
    responsible_id     = EXCLUDED.responsible_id,
    responsible_name   = EXCLUDED.responsible_name,
    responsible_since  = EXCLUDED.responsible_since,
    cost_center_id     = EXCLUDED.cost_center_id,
    cost_center_name   = EXCLUDED.cost_center_name,
    kind               = EXCLUDED.kind,
    category           = EXCLUDED.category,
    emission_norm      = EXCLUDED.emission_norm,
    fuel_primary       = EXCLUDED.fuel_primary,
    fuel_alt           = EXCLUDED.fuel_alt,
    purchase_price     = EXCLUDED.purchase_price,
    first_registration = EXCLUDED.first_registration,
    active             = EXCLUDED.active,
    raw_data           = EXCLUDED.raw_data,
    last_import_at     = EXCLUDED.last_import_at,
    updated_at         = now();

  v_inserted := v_total - v_updated;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'tc_vehicles.import_completed',
    jsonb_build_object('total', v_total, 'inserted', v_inserted, 'updated', v_updated)
  );

  RETURN jsonb_build_object('total', v_total, 'inserted', v_inserted, 'updated', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.tc_upsert_vehicles_audited(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tc_upsert_vehicles_audited(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tc_upsert_vehicles_audited(jsonb) TO service_role;
