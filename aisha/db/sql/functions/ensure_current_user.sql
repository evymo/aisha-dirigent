-- ============================================================================
-- Source of Truth: ensure_current_user
-- Purpose: Just-in-time (JIT) provisioning of the authenticated caller into
--          aisha_auth.users — the "first-request hook" that aisha_auth.users
--          was always documented to expect ("Populated by: keycloak-role-sync,
--          user_upsert triggers, or first-request hooks") but which was never
--          wired for runtime. Without it, a Keycloak user created after the
--          bootstrap import has a valid JWT (aisha_auth.uid() resolves their
--          sub-as-uuid) but NO aisha_auth.users row, so every write to a table
--          with a NOT NULL FK to aisha_auth.users (notification_preferences,
--          push_subscriptions, …) fails with FK violation 23503.
--
--          On first call this INSERTs the row; the AFTER INSERT trigger
--          on_auth_user_created → handle_new_user() then provisions the
--          member role + profile. Idempotent (ON CONFLICT DO NOTHING).
--
-- Returns: the provisioned user's id, or NULL for anonymous/service callers
--          (no JWT subject to provision).
-- Security: SECURITY DEFINER. Runs as the function owner (migration role),
--          which holds INSERT on aisha_auth.users; callers only have SELECT.
--          search_path includes aisha_auth so the cross-schema insert resolves.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ensure_current_user(
  p_email text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'aisha_auth'
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_email text;
BEGIN
  -- No JWT subject (anon / service-without-actor) → nothing to provision.
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  -- Already provisioned → fast path, no write.
  IF EXISTS (SELECT 1 FROM aisha_auth.users u WHERE u.id = v_uid) THEN
    RETURN v_uid;
  END IF;

  -- Resolve email best-effort: explicit arg > JWT email claim.
  v_email := COALESCE(
    NULLIF(btrim(COALESCE(p_email, '')), ''),
    NULLIF(auth.jwt() ->> 'email', '')
  );

  -- INSERT the registry anchor. The AFTER INSERT trigger
  -- (on_auth_user_created → handle_new_user) provisions role + profile.
  -- ON CONFLICT guards the race where two concurrent requests both miss the
  -- EXISTS check.
  INSERT INTO aisha_auth.users (id, email, raw_user_meta_data)
  VALUES (
    v_uid,
    v_email,
    jsonb_strip_nulls(jsonb_build_object(
      'provisioned_via', 'ensure_current_user',
      'email', v_email
    ))
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_current_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_current_user(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_current_user(text) TO service_role;

COMMENT ON FUNCTION public.ensure_current_user(text) IS
  'JIT-provisions the authenticated caller into aisha_auth.users (first-request hook). Idempotent; trigger handles role+profile. Returns the user id or NULL for anonymous callers.';
