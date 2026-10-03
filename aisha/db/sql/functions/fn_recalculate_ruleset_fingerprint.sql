-- Function: fn_recalculate_ruleset_fingerprint

CREATE OR REPLACE FUNCTION public.fn_recalculate_ruleset_fingerprint(p_rule_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_affected integer := 0;
  v_ruleset RECORD;
  v_new_fingerprint text;
BEGIN
  -- Find all story_rulesets that reference this rule_id
  FOR v_ruleset IN
    SELECT id, rule_ids
    FROM story_rulesets
    WHERE p_rule_id = ANY(rule_ids)
  LOOP
    -- Recalculate fingerprint from current published rules content
    SELECT md5(string_agg(
      er.slug || ':' || er.version::text || ':' || COALESCE(er.ai_instructions, ''),
      '|' ORDER BY er.slug
    ))
    INTO v_new_fingerprint
    FROM expert_rules er
    WHERE er.id = ANY(v_ruleset.rule_ids)
      AND er.status = 'published';

    -- Update fingerprint (NULL if no published rules remain)
    UPDATE story_rulesets
    SET ruleset_fingerprint = COALESCE(v_new_fingerprint, 'empty')
    WHERE id = v_ruleset.id
      AND ruleset_fingerprint IS DISTINCT FROM COALESCE(v_new_fingerprint, 'empty');

    IF FOUND THEN
      v_affected := v_affected + 1;
    END IF;
  END LOOP;

  RETURN v_affected;
END;
$function$;

REVOKE ALL ON FUNCTION fn_recalculate_ruleset_fingerprint(p_rule_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_recalculate_ruleset_fingerprint(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_recalculate_ruleset_fingerprint(uuid) TO service_role;
