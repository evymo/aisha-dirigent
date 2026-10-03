-- Function: create_lab_test_order
-- Description: Create a new lab test order from AI recommendations
-- Created: 2026-02-03

CREATE OR REPLACE FUNCTION create_lab_test_order(
  p_tests jsonb,
  p_story_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_order_id uuid;
  v_total_price numeric(10,2);
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Validate tests array
  IF p_tests IS NULL OR jsonb_array_length(p_tests) = 0 THEN
    RAISE EXCEPTION 'At least one test is required';
  END IF;

  -- Calculate total price from tests array
  SELECT COALESCE(SUM((test->>'price')::numeric), 0)
  INTO v_total_price
  FROM jsonb_array_elements(p_tests) AS test;

  -- Create order
  INSERT INTO lab_test_orders (
    user_id,
    tests,
    story_id,
    metadata,
    total_price,
    status
  )
  VALUES (
    v_user_id,
    p_tests,
    p_story_id,
    p_metadata,
    v_total_price,
    'pending'
  )
  RETURNING id INTO v_order_id;

  -- Audit log
  INSERT INTO audit_journal (
    user_id,
    action,
    metadata
  )
  VALUES (
    v_user_id,
    'LAB_TEST_ORDER_CREATED',
    jsonb_build_object(
      'area', 'lab_tests',
      'severity', 'info',
      'order_id', v_order_id,
      'test_count', jsonb_array_length(p_tests),
      'total_price', v_total_price
    )
  );

  RETURN v_order_id;
END;
$$;

-- Security
REVOKE ALL ON FUNCTION create_lab_test_order(jsonb, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_lab_test_order(jsonb, uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION create_lab_test_order(jsonb, uuid, jsonb) IS 'Create a new lab test order with audit logging';
