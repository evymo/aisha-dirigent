-- Function: public.log_permission_change
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:55+01:00

CREATE OR REPLACE FUNCTION public.log_permission_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new jsonb;
  v_old jsonb;
BEGIN
  -- audit_logs may not exist yet during initial bootstrap/migrations.
  -- Never fail permission writes just because audit trail table is created later.
  IF to_regclass('public.audit_logs') IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
    INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
    VALUES (
      auth.uid(),
      'grant_permission',
      TG_TABLE_NAME,
      COALESCE(v_new->>'id', NULL),
      jsonb_build_object(
        'role', v_new->>'role',
        'permission_id', v_new->>'permission_id',
        'section', v_new->>'section',
        'permission', v_new->>'permission'
      )
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_values)
    VALUES (
      auth.uid(),
      'revoke_permission',
      TG_TABLE_NAME,
      COALESCE(v_old->>'id', NULL),
      jsonb_build_object(
        'role', v_old->>'role',
        'permission_id', v_old->>'permission_id',
        'section', v_old->>'section',
        'permission', v_old->>'permission'
      )
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.log_permission_change() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_permission_change() TO authenticated;
