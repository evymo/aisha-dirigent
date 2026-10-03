-- Function: public.get_system_config
-- Arguments: p_key text DEFAULT NULL, p_with_meta boolean DEFAULT false
-- Description: Get system configuration. If p_key is NULL, returns all public configs as object.
--              If p_with_meta is true and p_key is provided, returns object with value + updated_at.
-- Security: SECURITY DEFINER - public system configuration.
-- @security: public
-- @audit: none

DROP FUNCTION IF EXISTS public.get_system_config(text);

CREATE OR REPLACE FUNCTION public.get_system_config(
  p_key text DEFAULT NULL,
  p_with_meta boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_key IS NOT NULL THEN
    IF p_with_meta THEN
      SELECT jsonb_build_object(
        'key', key,
        'value', value,
        'updated_at', updated_at
      ) INTO v_result
      FROM system_config
      WHERE key = p_key AND (is_public = true OR auth.uid() IS NOT NULL);

      RETURN COALESCE(
        v_result,
        jsonb_build_object(
          'key', p_key,
          'value', '{}'::jsonb,
          'updated_at', NULL
        )
      );
    END IF;

    -- Return single config value
    SELECT value INTO v_result
    FROM system_config
    WHERE key = p_key AND (is_public = true OR auth.uid() IS NOT NULL);
  ELSE
    -- Return all public configs as object
    SELECT jsonb_object_agg(key, value) INTO v_result
    FROM system_config
    WHERE is_public = true OR auth.uid() IS NOT NULL;
  END IF;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_system_config(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_system_config(text, boolean) TO public;
