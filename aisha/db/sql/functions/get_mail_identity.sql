-- Function: public.get_mail_identity
-- Resolves a user's email IDENTITY from the Keycloak-rooted identity already in the
-- stack — NOT a parallel identity system. The TIER (and therefore domain + quota) is
-- DERIVED, never self-assigned:
--     admin    : KC admin role (user_roles) or admin/staff   → mail.domain.admin   / mail.quota.admin.mb
--     partner  : partner_profiles.is_certified = true         → mail.domain.partner / mail.quota.partner.mb
--     user     : everyone else                                → mail.domain.user    / mail.quota.user.mb
--
-- Domains + quotas are PARAMETRIC (system_config keys mail.domain.* / mail.quota.*.mb),
-- set per-instance at cold-start (from MAIL_USER_DOMAIN / MAIL_PARTNER_DOMAIN env) or by
-- an admin — NOT hardcoded here (keeps the OSS baseline instance-agnostic). A quota of 0
-- (or absent) means UNLIMITED. The local-part derives from the KC-synced profile
-- (nickname → email-localpart → user-<id8>), sanitised to a safe address charset.
--
-- Security: SECURITY DEFINER, STABLE. AUTH-FIRST — a non-privileged caller is pinned to their
-- OWN identity (p_user_id is IGNORED, so it can never be used to impersonate); only service_role
-- (system) or an authenticated admin/staff may resolve another user via p_user_id. The
-- derivation never puts the parameter ahead of the JWT identity in a COALESCE (the
-- parameter-first impersonation footgun) — the JWT identity always wins for ordinary callers.
-- @security: own-or-privileged

CREATE OR REPLACE FUNCTION public.get_mail_identity(
  p_user_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_service boolean := current_setting('role', true) = 'service_role';
  v_caller     uuid := auth.uid();
  v_uid        uuid;
  v_tier       text;
  v_domain     text;
  v_quota      int;
  v_nickname   text;
  v_email      text;
  v_base       text;
  v_local      text;
BEGIN
  -- Auth-first identity resolution. A non-privileged caller is PINNED to their own identity
  -- (p_user_id ignored ⇒ cannot impersonate); only service_role (system) or an authenticated
  -- admin/staff may target another user via p_user_id. This replaces the parameter-first
  -- COALESCE footgun (parameter ahead of the JWT) + its now-redundant impersonation guard.
  IF v_is_service OR (v_caller IS NOT NULL AND public.is_admin_or_staff(v_caller)) THEN
    v_uid := COALESCE(p_user_id, v_caller);
  ELSE
    v_uid := v_caller;
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  -- Tier — derived from the KC-rooted identity (roles + partner certification).
  IF public.has_role(v_uid, 'admin') OR public.is_admin_or_staff(v_uid) THEN
    v_tier := 'admin';
  ELSIF EXISTS (SELECT 1 FROM public.partner_profiles pp WHERE pp.user_id = v_uid AND pp.is_certified) THEN
    v_tier := 'partner';
  ELSE
    v_tier := 'user';
  END IF;

  -- Parametric domain + quota for the tier (direct read; DEFINER bypasses RLS).
  SELECT value #>> '{}' INTO v_domain FROM public.system_config WHERE key = 'mail.domain.' || v_tier;
  SELECT (value #>> '{}')::int INTO v_quota FROM public.system_config WHERE key = 'mail.quota.' || v_tier || '.mb';

  -- Local-part from the KC-synced profile, sanitised to [a-z0-9._-].
  SELECT p.nickname, p.email INTO v_nickname, v_email FROM public.profiles p WHERE p.user_id = v_uid;
  v_base  := COALESCE(NULLIF(trim(v_nickname), ''), NULLIF(split_part(COALESCE(v_email, ''), '@', 1), ''), 'user-' || left(v_uid::text, 8));
  v_local := regexp_replace(lower(v_base), '[^a-z0-9._-]+', '', 'g');
  IF v_local IS NULL OR v_local = '' THEN
    v_local := 'user-' || left(v_uid::text, 8);
  END IF;

  RETURN jsonb_build_object(
    'user_id',    v_uid,
    'tier',       v_tier,
    'local_part', v_local,
    'domain',     v_domain,
    'address',    CASE WHEN v_domain IS NOT NULL AND v_domain <> '' THEN v_local || '@' || v_domain ELSE NULL END,
    'quota_mb',   v_quota,
    'unlimited',  (v_quota IS NULL OR v_quota = 0),
    'configured', (v_domain IS NOT NULL AND v_domain <> '')
  );
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_mail_identity(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_mail_identity(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_mail_identity(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_mail_identity(uuid) TO service_role;
