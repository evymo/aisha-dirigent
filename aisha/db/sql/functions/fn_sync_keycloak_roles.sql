-- Function: fn_sync_keycloak_roles

CREATE OR REPLACE FUNCTION public.fn_sync_keycloak_roles()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_permission_code text;
  v_action text;
  v_role text;
  v_payload jsonb;
  v_functions_url text;
  v_service_key text;
  v_request_id bigint;
BEGIN
  -- Determine action and affected row
  IF TG_OP = 'INSERT' THEN
    SELECT code INTO v_permission_code
    FROM permissions WHERE id = NEW.permission_id;
    v_action := 'grant';
    v_role := NEW.role::text;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT code INTO v_permission_code
    FROM permissions WHERE id = OLD.permission_id;
    v_action := 'revoke';
    v_role := OLD.role::text;
  END IF;

  -- Only sync known admin_tools permissions
  IF v_permission_code IS NULL
     OR v_permission_code NOT IN ('access_studio', 'access_n8n')
  THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Build webhook payload
  v_payload := jsonb_build_object(
    'action', v_action,
    'role', v_role,
    'permission_code', v_permission_code
  );

  -- Fire edge function via net.http_post (best-effort, same pattern as
  -- fn_queue_embedding_generation and fn_notify_ai_feedback_ready)
  BEGIN
    v_functions_url := current_setting('app.settings.supabase_functions_internal_url', true);
    v_service_key := current_setting('app.settings.supabase_service_role_key', true);

    IF v_functions_url IS NOT NULL AND v_functions_url != ''
       AND v_service_key IS NOT NULL AND v_service_key != ''
    THEN
      SELECT net.http_post(
        url     := v_functions_url || '/functions/v1/keycloak-role-sync',
        body    := v_payload,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_service_key
        )
      ) INTO v_request_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Best-effort: log failure but never block the permission change
    -- user_id = auth.uid() (nullable). The COALESCE fallback to '00000000-…0000'
    -- substituted a non-existent aisha_auth.users id → audit_journal_user_id_fkey
    -- violation, which (in this EXCEPTION handler) propagated out and BLOCKED the
    -- permission change — the opposite of "never block". NULL is FK-safe.
    INSERT INTO audit_journal (user_id, action, metadata)
    VALUES (
      auth.uid(),
      'KEYCLOAK_ROLE_SYNC_FAILED',
      jsonb_build_object(
        'severity', 'warning',
        'area', 'security',
        'entity_type', 'app_role_permissions',
        'payload', v_payload,
        'error', SQLERRM
      )
    );
  END;

  RETURN COALESCE(NEW, OLD);
END;
$function$

;

REVOKE ALL ON FUNCTION fn_sync_keycloak_roles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_sync_keycloak_roles() TO service_role;
