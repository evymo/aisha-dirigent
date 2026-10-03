-- Function: public.handle_auth_send_email
-- Arguments: event jsonb
-- Description: Auth-event email + push notification dispatcher.
--              Send-email hook pro Keycloak architekturu
--              where a Keycloak event-listener bridge service (Java SPI / svc-keycloak-bridge)
--              translates Keycloak auth events to the same JSON payload contract and calls
--              this function via service_role. The function forwards the payload through the
--              gateway-compatible /functions/v1 endpoint which delivers via Resend (email) +
--              FCM/WebPush (push notification).
-- Security: SECURITY DEFINER — callable by aisha_admin and service_role only.
-- @security: callable by aisha_admin/service_role (NOT by authenticated/anon)

CREATE OR REPLACE FUNCTION public.handle_auth_send_email(event jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_edge_url   text;
  v_svc_token  text;
  v_request_id bigint;
BEGIN
  -- Read configuration from vault (production).
  -- Falls back to internal gateway when vault is empty (local dev / first-boot).
  SELECT decrypted_secret INTO v_edge_url
    FROM vault.decrypted_secrets
   WHERE name = 'edge_functions_url'
   LIMIT 1;

  -- Service token for the auth mail dispatcher (rotated independently of Keycloak realm secrets).
  SELECT decrypted_secret INTO v_svc_token
    FROM vault.decrypted_secrets
   WHERE name = 'edge_service_token'
   LIMIT 1;

  -- Local-dev fallback: project-internal gateway hostname.
  IF v_edge_url IS NULL THEN
    v_edge_url := 'http://gateway:8080/functions/v1';
  END IF;

  -- Enqueue the HTTP request asynchronously — does not block the calling Keycloak bridge.
  BEGIN
    SELECT net.http_post(
      url     := v_edge_url || '/auth-send-email',
      body    := event,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || COALESCE(v_svc_token, 'local-dev-no-token')
      )
    ) INTO v_request_id;
  EXCEPTION WHEN OTHERS THEN
    -- pg_net failure must NOT crash the bridge — log with cooldown to prevent flood.
    -- Only log if no recent identical failure in last 5 minutes.
    IF NOT EXISTS (
      SELECT 1 FROM audit_journal
       WHERE action = 'AUTH_EMAIL_DELIVERY_FAILED'
         AND created_at > now() - interval '5 minutes'
       LIMIT 1
    ) THEN
      -- user_id = auth.uid() (nullable): the '00000000-…0000' sentinel is not a
      -- real aisha_auth.users row → it violated audit_journal_user_id_fkey, so the
      -- "email delivery failed" audit itself failed.
      INSERT INTO audit_journal(user_id, action, metadata)
      VALUES (
        auth.uid(),
        'AUTH_EMAIL_DELIVERY_FAILED',
        jsonb_build_object(
          'severity', 'critical',
          'edge_url', v_edge_url,
          'error',    SQLERRM
        )
      );
    END IF;
    RAISE WARNING '[handle_auth_send_email] pg_net http_post failed: %', SQLERRM;
  END;

  -- Returning void = success signal back to the Keycloak bridge caller.
END;
$$;

COMMENT ON FUNCTION public.handle_auth_send_email(jsonb) IS
  'Auth-event email + push dispatcher. Reworked for Keycloak: callable by aisha_admin/service_role from the Keycloak event-listener bridge service. Forwards payload through the gateway-compatible /functions/v1/auth-send-email endpoint. Includes 5-min cooldown on error logging to prevent audit_journal flood.';

-- Permissions: callable by backend bridge services as aisha_admin or service_role.
REVOKE ALL ON FUNCTION public.handle_auth_send_email(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_auth_send_email(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_auth_send_email(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.handle_auth_send_email(jsonb) TO aisha_admin;
GRANT EXECUTE ON FUNCTION public.handle_auth_send_email(jsonb) TO service_role;
