-- ============================================================================
-- Source of Truth: wd_twin_fleet_current
-- Popis: Dispečerská mapa v DOMÉNOVÉM tvaru (zadání digital twin §7: extranet
--        nezná raw strukturu zdroje): aktuální polohy z wd_vehicle_positions_
--        current obohacené o twin identity — vozidlo přes potvrzenou primární
--        ref, řidič TEMPORÁLNĚ přes čip (ref_kind='field_identity',
--        driver_card, platnost k position_time — jízda se resolvne na
--        TEHDEJŠÍHO držitele čipu, ne dnešního).
--        Patří do wd_* domény (kanonický slug zdroje 'webdispecink' — stejná
--        vendor vazba jako wd_* tabulky); twin jádro samo zůstává generické.
--        Vozidla bez twinu se vracejí s vehicle_twin_id NULL (mapa je úplná,
--        chybějící mapování je vidět — kandidát na twin_upsert adaptérem).
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT (admin/staff/service — polohy
--        celé flotily nejsou „moje věci", viz twin_list_mine)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.wd_twin_fleet_current(
  p_limit integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service boolean := public.is_service_role();
  v_items jsonb;
BEGIN
  -- Authorization check (FIRST, before any data access)
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 2000 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 2000';
  END IF;

  SELECT COALESCE(jsonb_agg(item ORDER BY item->>'position_time' DESC), '[]'::jsonb) INTO v_items
  FROM (
    SELECT jsonb_build_object(
      'vehicle_twin_id', vt.twin_id,
      'vehicle_label', COALESCE(te.label, v.identifier),
      'wd_car_id', p.wd_car_id,
      'driver_twin_id', dt.twin_id,
      'driver_label', de.label,
      'position_time', p.position_time,
      'latitude', p.latitude,
      'longitude', p.longitude,
      'speed_kmh', p.speed_kmh,
      'moving', p.moving,
      'location_text', p.location_text,
      'odometer_km', p.odometer_km,
      'fuel_level', p.fuel_level
    ) AS item
    FROM public.wd_vehicle_positions_current p
    LEFT JOIN public.wd_vehicles v ON v.wd_car_id = p.wd_car_id
    -- vozidlo: potvrzená primární identita ve zdroji 'webdispecink'
    LEFT JOIN public.twin_external_refs vt
      ON vt.source = 'webdispecink'
     AND vt.ref_kind = 'primary_id'
     AND vt.entity_type = 'vehicle'
     AND vt.source_key = p.wd_car_id::text
     AND vt.state = 'confirmed'
     AND vt.valid_to IS NULL
    LEFT JOIN public.twin_entities te ON te.id = vt.twin_id
    -- řidič: čip TEMPORÁLNĚ k času polohy (handover-safe)
    LEFT JOIN public.twin_external_refs dt
      ON dt.source = 'webdispecink'
     AND dt.ref_kind = 'field_identity'
     AND dt.entity_type = 'driver'
     AND dt.source_key = p.driver_card
     AND dt.state = 'confirmed'
     AND dt.valid_from <= p.position_time
     AND (dt.valid_to IS NULL OR dt.valid_to > p.position_time)
    LEFT JOIN public.twin_entities de ON de.id = dt.twin_id
    ORDER BY p.position_time DESC
    LIMIT p_limit
  ) AS q;

  RETURN v_items;
END;
$$;

REVOKE ALL ON FUNCTION public.wd_twin_fleet_current(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wd_twin_fleet_current(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wd_twin_fleet_current(integer) TO service_role;
