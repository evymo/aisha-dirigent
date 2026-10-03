-- Function: audience_autorevoke_public_execute

CREATE OR REPLACE FUNCTION public.audience_autorevoke_public_execute()
 RETURNS event_trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  obj RECORD;
BEGIN
  FOR obj IN
    SELECT object_identity, schema_name, object_type
    FROM pg_event_trigger_ddl_commands()
  LOOP
    -- object_identity for a function is e.g. 'public.audience_foo(uuid, text)'.
    -- Match only public.audience_* functions; leave everything else untouched.
    IF obj.object_type = 'function'
       AND obj.schema_name = 'public'
       AND obj.object_identity LIKE 'public.audience\_%' THEN

      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', obj.object_identity);

      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', obj.object_identity);
      END IF;

      RAISE NOTICE 'audience auto-lockdown: revoked PUBLIC/anon EXECUTE on %', obj.object_identity;
    END IF;
  END LOOP;
END;
$function$

;

REVOKE ALL ON FUNCTION audience_autorevoke_public_execute() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_autorevoke_public_execute() TO service_role;
