-- Function: create_product_plan_audited
-- Creates a new product plan for the authenticated user
-- Security: DEFINER with audit trail
-- Created: 2026-01-17

CREATE OR REPLACE FUNCTION public.create_product_plan_audited(
  p_name text,
  p_dose_amount numeric,
  p_dose_unit text DEFAULT 'kapky',
  p_doses_per_day int DEFAULT 1,
  p_dose_timing text[] DEFAULT ARRAY['morning'],
  p_product_id uuid DEFAULT NULL,
  p_protocol_id uuid DEFAULT NULL,
  p_reminder_enabled boolean DEFAULT false,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
DECLARE
  v_plan_id uuid;
  v_protocol record;
BEGIN
  -- If protocol_id provided, get distribution from protocol
  IF p_protocol_id IS NOT NULL THEN
    SELECT * INTO v_protocol FROM distribution_protocols WHERE id = p_protocol_id AND is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Protocol not found or not active';
    END IF;
  END IF;

  -- Create the product plan
  INSERT INTO member_product_plans (
    user_id,
    name,
    dose_amount,
    dose_unit,
    doses_per_day,
    dose_timing,
    product_id,
    product_id,
    protocol_id,
    reminder_enabled,
    notes,
    is_active,
    show_on_dashboard
  ) VALUES (
    auth.uid(),
    p_name,
    COALESCE(v_protocol.dose_amount, p_dose_amount),
    COALESCE(v_protocol.dose_unit, p_dose_unit),
    COALESCE(v_protocol.doses_per_day, p_doses_per_day),
    COALESCE(v_protocol.dose_timing, p_dose_timing),
    COALESCE(v_protocol.product_id, p_product_id),
    p_product_id,
    p_protocol_id,
    p_reminder_enabled,
    p_notes,
    true,
    true
  )
  RETURNING id INTO v_plan_id;

  -- Audit log
  INSERT INTO audit_journal (user_id, action_type, entity_type, entity_id, area, severity, summary)
  VALUES (
    auth.uid(), 
    'create', 
    'member_product_plan', 
    v_plan_id::text, 
    'member', 
    'info', 
    format('Created product plan: %s', p_name)
  );

  RETURN v_plan_id;
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.create_product_plan_audited(text, numeric, text, int, text[], uuid, uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_product_plan_audited(text, numeric, text, int, text[], uuid, uuid, boolean, text) TO authenticated;

COMMENT ON FUNCTION public.create_product_plan_audited(text, numeric, text, int, text[], uuid, uuid, boolean, text) IS 
'Creates a new product plan for the authenticated user. Can use a distribution protocol for default values. Audited.';
