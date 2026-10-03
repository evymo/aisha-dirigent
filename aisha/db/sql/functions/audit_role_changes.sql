-- Function: public.audit_role_changes
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:53+01:00

CREATE OR REPLACE FUNCTION public.audit_role_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Guard: audit_logs may not exist during initial bootstrap
  IF to_regclass('public.audit_logs') IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (
      user_id,
      action,
      table_name,
      record_id,
      new_values,
      ip_address
    ) VALUES (
      auth.uid(),
      'role_created',
      'roles',
      NEW.id,
      jsonb_build_object(
        'name', NEW.name,
        'is_admin', NEW.is_admin,
        'is_system', NEW.is_system
      ),
      NULL
    );
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_logs (
      user_id,
      action,
      table_name,
      record_id,
      old_values,
      new_values,
      ip_address
    ) VALUES (
      auth.uid(),
      'role_updated',
      'roles',
      NEW.id,
      jsonb_build_object(
        'name', OLD.name,
        'is_admin', OLD.is_admin,
        'can_manage_users', OLD.can_manage_users
      ),
      jsonb_build_object(
        'name', NEW.name,
        'is_admin', NEW.is_admin,
        'can_manage_users', NEW.can_manage_users
      ),
      NULL
    );
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs (
      user_id,
      action,
      table_name,
      record_id,
      old_values,
      ip_address
    ) VALUES (
      auth.uid(),
      'role_deleted',
      'roles',
      OLD.id,
      jsonb_build_object('name', OLD.name),
      NULL
    );
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.audit_role_changes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_role_changes() TO authenticated;
