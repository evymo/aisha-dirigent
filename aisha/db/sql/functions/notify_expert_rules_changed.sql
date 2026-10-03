-- Function: notify_expert_rules_changed

CREATE OR REPLACE FUNCTION public.notify_expert_rules_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rule_slug text;
  v_action text;
  v_admin_id uuid;
BEGIN
  -- Determine which rule changed
  IF TG_OP = 'DELETE' THEN
    v_rule_slug := OLD.slug;
  ELSE
    v_rule_slug := NEW.slug;
  END IF;

  v_action := TG_OP;

  -- Notify all admin and staff users (limit 50 to prevent runaway)
  FOR v_admin_id IN
    SELECT DISTINCT ur.user_id
    FROM user_roles ur
    WHERE ur.role IN ('admin', 'staff')
    LIMIT 50
  LOOP
    INSERT INTO notifications (user_id, title, message, type, metadata)
    VALUES (
      v_admin_id,
      'Expert rules updated: ' || COALESCE(v_rule_slug, 'unknown'),
      'Rule "' || COALESCE(v_rule_slug, 'unknown') || '" was ' ||
        CASE v_action
          WHEN 'INSERT' THEN 'added'
          WHEN 'UPDATE' THEN 'modified'
          WHEN 'DELETE' THEN 'removed'
          ELSE 'changed'
        END || '. Sync copilot-instructions.md to get the latest rules.',
      'rules_updated',
      jsonb_build_object(
        'source', 'aisha',
        'rule_slug', COALESCE(v_rule_slug, 'unknown'),
        'operation', v_action,
        'auto_sync', true
      )
    );
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION notify_expert_rules_changed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notify_expert_rules_changed() TO authenticated;
GRANT EXECUTE ON FUNCTION notify_expert_rules_changed() TO service_role;
