-- Function: public.manage_guild_member_expertise
-- Arguments: p_expertise_entries jsonb
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.manage_guild_member_expertise(p_expertise_entries jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid;
  v_partner_id uuid;
  v_entry jsonb;
  v_area_id uuid;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id INTO v_partner_id
  FROM partner_profiles WHERE user_id = v_caller_id;

  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'Only partners can manage expertise';
  END IF;

  -- Remove all current entries
  DELETE FROM guild_member_expertise WHERE partner_id = v_partner_id;

  -- Insert new entries
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_expertise_entries)
  LOOP
    SELECT id INTO v_area_id
    FROM guild_expertise_areas WHERE slug = v_entry->>'expertise_area_slug' AND is_active = true;

    IF v_area_id IS NOT NULL THEN
      INSERT INTO guild_member_expertise (
        partner_id, expertise_area_id, proficiency_level, years_experience,
        description, is_primary
      ) VALUES (
        v_partner_id,
        v_area_id,
        COALESCE((v_entry->>'proficiency_level')::int, 1),
        (v_entry->>'years_experience')::int,
        v_entry->>'description',
        COALESCE((v_entry->>'is_primary')::boolean, false)
      );
    END IF;
  END LOOP;

  -- Audit
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (v_caller_id, 'GUILD_EXPERTISE_UPDATE', jsonb_build_object(
    'area', 'knowledge', 'severity', 'info', 'partner_id', v_partner_id
  ));

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.manage_guild_member_expertise(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_guild_member_expertise(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manage_guild_member_expertise(jsonb) TO service_role;
