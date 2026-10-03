-- Function: public.reject_story_promotion
-- Arguments: p_operation_id uuid, p_reason text DEFAULT NULL
-- Description: Rejects a pending promote operation. Nothing is materialized;
--              the operation outcome becomes 'rejected' with the optional
--              reason stored in outcome_detail. The payload stays in operation
--              metadata for later inspection.
-- Security: SECURITY DEFINER — admin/staff only (auth.uid() required)

CREATE OR REPLACE FUNCTION public.reject_story_promotion(
  p_operation_id uuid,
  p_reason text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_operation record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff role required' USING ERRCODE = '22023';
  END IF;

  SELECT sso.id, sso.story_id, sso.operation_type, sso.outcome,
         sso.source_instance_id, sso.target_instance_id
  INTO v_operation
  FROM story_sync_operations sso
  WHERE sso.id = p_operation_id
  FOR UPDATE;

  IF v_operation.id IS NULL THEN
    RAISE EXCEPTION 'Sync operation not found: %', p_operation_id USING ERRCODE = '22023';
  END IF;

  IF v_operation.operation_type != 'promote' THEN
    RAISE EXCEPTION 'Operation % is not a promote operation (type: %)',
      p_operation_id, v_operation.operation_type USING ERRCODE = '22023';
  END IF;

  IF v_operation.outcome != 'pending' THEN
    RAISE EXCEPTION 'Operation % is not pending (outcome: %)',
      p_operation_id, v_operation.outcome USING ERRCODE = '22023';
  END IF;

  UPDATE story_sync_operations SET
    outcome = 'rejected',
    outcome_detail = p_reason,
    metadata = metadata || jsonb_build_object(
      'rejected_by', v_user_id,
      'rejected_at', now()
    )
  WHERE id = p_operation_id;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (v_user_id, 'STORY_PROMOTE_REJECTED', jsonb_build_object(
    'area', 'story_sync',
    'severity', 'info',
    'entity_type', 'story_sync_operation',
    'entity_id', p_operation_id,
    'story_id', v_operation.story_id,
    'source_instance_id', v_operation.source_instance_id,
    'target_instance_id', v_operation.target_instance_id,
    'reason', p_reason
  ));

  RETURN jsonb_build_object(
    'status', 'rejected',
    'operation_id', p_operation_id,
    'reason', p_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_story_promotion(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_story_promotion(uuid, text) TO authenticated;
