-- Function: audience_provision_federated_member

CREATE OR REPLACE FUNCTION public.audience_provision_federated_member(p_source_uuid uuid, p_email text, p_display_name text DEFAULT NULL::text, p_language text DEFAULT 'en'::text, p_tier text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := p_source_uuid;
  v_twin jsonb;  -- reuse source uuid as aisha identity
BEGIN
  IF p_source_uuid IS NULL OR p_email IS NULL THEN
    RAISE EXCEPTION 'provision_federated_member: source_uuid and email required';
  END IF;

  -- 1. aisha_auth.users — the FK target for profiles + RLS auth.uid()
  INSERT INTO aisha_auth.users (id, email, raw_user_meta_data, created_at, updated_at)
  VALUES (
    v_uid, p_email,
    jsonb_build_object(
      'source', 'source-federation',
      'federated_from', 'source-api',
      'community_member', true,
      'source_tier', p_tier
    ),
    now(), now()
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        raw_user_meta_data = aisha_auth.users.raw_user_meta_data
          || jsonb_build_object('community_member', true, 'source_tier', p_tier),
        updated_at = now();

  -- 2. public.profiles — display identity for the audience module
  INSERT INTO public.profiles (id, user_id, email, display_name, preferred_language, created_at, updated_at)
  VALUES (gen_random_uuid(), v_uid, p_email, p_display_name, COALESCE(p_language, 'en'), now(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET email = EXCLUDED.email,
        display_name = COALESCE(EXCLUDED.display_name, public.profiles.display_name),
        preferred_language = EXCLUDED.preferred_language,
        updated_at = now();

  -- 2b. Dvojče + reference účtu (ADR-003 K1): identita je entita, účet je
  --     jedna potvrzená reference. Primární identita zdroje je potvrzená
  --     systémem — binding zdroje je schválený jako celek (approve_source),
  --     per-člen review by byl jen šum. Vedlejší účinek nesmí zničit akt (Z7).
  BEGIN
    v_twin := public.twin_upsert_entity_audited('person', 'source-federation', p_source_uuid::text,
                                                p_display_name, NULL, NULL);
    PERFORM public.twin_ensure_for_account(v_uid, p_display_name, 'person', (v_twin->>'twin_id')::uuid);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'twin not ensured for federated member %: %', v_uid, SQLERRM;
  END;

  -- 3. Audit the federation event
  PERFORM public.audience_log_event(
    'provision', 'federated_member', 'actor', v_uid,
    'Source-federated member provisioned',
    jsonb_build_object('email', p_email, 'tier', p_tier, 'source', 'source-api')
  );

  RETURN v_uid;
END;
$function$

;

REVOKE ALL ON FUNCTION audience_provision_federated_member(uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_provision_federated_member(uuid,text,text,text,text) TO service_role;
