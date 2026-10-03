-- Function: public.edge_database_dump_table
-- Purpose: Export allowlisted public tables with explicit column lists generated from schema metadata.

CREATE OR REPLACE FUNCTION public.edge_database_dump_table(
  p_actor_user_id uuid,
  p_table text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
  v_allowlist text[] := ARRAY[
    'archive_documents',
    'audit_journal',
    'cart_items',
    'consents',
    'data_sharing_consents',
    'dosing_logs',
    'health_check_ins',
    'invitations',
    'lab_results',
    'memberships',
    'member_health_documents',
    'notifications',
    'onboarding_responses',
    'order_items',
    'orders',
    'partner_appointments',
    'partner_availability',
    'partner_certifications',
    'partner_profiles',
    'products',
    'production_batches',
    'profiles',
    'studies',
    'study_registrations',
    'token_transactions',
    'user_roles'
  ];
  v_columns text;
  v_rows jsonb;
BEGIN
  IF v_actor_user_id IS NULL AND v_jwt_role = 'service_role' THEN
    v_actor_user_id := p_actor_user_id;
  END IF;

  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing actor user';
  END IF;

  IF NOT public.has_role(v_actor_user_id, 'admin')
     AND NOT public.has_role(v_actor_user_id, 'staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_table IS NULL OR NOT (p_table = ANY(v_allowlist)) THEN
    RAISE EXCEPTION 'Table not allowlisted: %', p_table;
  END IF;

  SELECT string_agg(format('%I', c.column_name), ', ' ORDER BY c.ordinal_position)
  INTO v_columns
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = p_table;

  IF v_columns IS NULL THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb);
  END IF;

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM (SELECT %s FROM public.%I) t',
    v_columns,
    p_table
  )
  INTO v_rows;

  RETURN jsonb_build_object('rows', COALESCE(v_rows, '[]'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.edge_database_dump_table(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edge_database_dump_table(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.edge_database_dump_table(uuid, text) TO authenticated;
