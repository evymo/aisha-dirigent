-- get_partner_free_slots(p_date, p_partner_id, p_slot_interval_minutes)
--
-- Returns free (available and unbooked) booking slots for a partner on a given date.
-- Combines availability windows and booked appointments server-side,
-- generating discrete time slots within each availability window and
-- subtracting already-booked appointments (with configurable buffer).
--
-- Slot duration and buffer between appointments are read from `partner_profiles`.
-- An explicit `p_slot_interval_minutes` overrides the profile's `slot_duration_minutes`.
--
-- Parameters (alphabetically sorted):
--   p_date                   - The date for which to compute free slots
--   p_partner_id             - The partner's UUID
--   p_slot_interval_minutes  - Optional override for slot duration (default: profile setting or 30)
--
-- Returns: jsonb array of { start_time, end_time, is_online }
--
-- Security: SECURITY DEFINER (anon + authenticated) for public booking page

CREATE OR REPLACE FUNCTION public.get_partner_free_slots(
  p_date date,
  p_partner_id uuid,
  p_slot_interval_minutes integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_day_of_week integer;
  v_slot_minutes integer;
  v_buffer_minutes integer;
  v_result jsonb;
BEGIN
  -- Day of week: PostgreSQL EXTRACT(dow) = 0 (Sun) .. 6 (Sat) = JS getDay()
  v_day_of_week := EXTRACT(dow FROM p_date)::integer;

  -- Read partner settings; fall back to defaults if profile missing
  SELECT
    COALESCE(p_slot_interval_minutes, pp.slot_duration_minutes, 30),
    COALESCE(pp.buffer_minutes, 0)
  INTO v_slot_minutes, v_buffer_minutes
  FROM partner_profiles pp
  WHERE pp.id = p_partner_id;

  -- If partner not found, use parameter or default
  IF NOT FOUND THEN
    v_slot_minutes := COALESCE(p_slot_interval_minutes, 30);
    v_buffer_minutes := 0;
  END IF;

  WITH availability_slots AS (
    -- Expand each availability window into discrete time slots
    SELECT
      gs.slot_start::time AS start_time,
      (gs.slot_start + make_interval(mins => v_slot_minutes))::time AS end_time,
      pa.is_online
    FROM partner_availability pa
    CROSS JOIN LATERAL generate_series(
      p_date + pa.start_time,
      p_date + pa.end_time - make_interval(mins => v_slot_minutes),
      make_interval(mins => v_slot_minutes)
    ) AS gs(slot_start)
    WHERE pa.partner_id = p_partner_id
      AND pa.day_of_week = v_day_of_week
      AND COALESCE(pa.is_available, true) = true
  ),
  booked_with_buffer AS (
    -- Booked windows expanded by buffer on both sides
    SELECT
      (apt.start_time - make_interval(mins => v_buffer_minutes))::time AS blocked_from,
      (apt.end_time   + make_interval(mins => v_buffer_minutes))::time AS blocked_until
    FROM partner_appointments apt
    WHERE apt.partner_id = p_partner_id
      AND apt.appointment_date = p_date
      AND apt.status != 'cancelled'
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'start_time', to_char(s.start_time, 'HH24:MI'),
      'end_time',   to_char(s.end_time,   'HH24:MI'),
      'is_online',  s.is_online
    )
    ORDER BY s.start_time
  )
  INTO v_result
  FROM availability_slots s
  WHERE NOT EXISTS (
    -- Slot is blocked if it overlaps any booked+buffer window
    SELECT 1 FROM booked_with_buffer b
    WHERE s.start_time < b.blocked_until
      AND s.end_time   > b.blocked_from
  );

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_partner_free_slots(date, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_free_slots(date, uuid, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_partner_free_slots(date, uuid, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.get_partner_free_slots(date, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_free_slots(date, uuid, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_partner_free_slots(date, uuid, integer) TO authenticated;
