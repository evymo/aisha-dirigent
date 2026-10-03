-- Function: public.create_supported_language
-- Arguments: p_code text, p_name_key text, p_name_native text, p_is_active boolean, p_is_default boolean, p_sort_order integer
-- Description: Creates a new supported language entry. Admin only.
-- Security: SECURITY DEFINER with admin guard.
-- @admin: true

CREATE OR REPLACE FUNCTION public.create_supported_language(
  p_code text,
  p_name_key text,
  p_name_native text,
  p_is_active boolean DEFAULT true,
  p_is_default boolean DEFAULT false,
  p_sort_order integer DEFAULT 0
)
 RETURNS SETOF supported_languages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  RETURN QUERY
  INSERT INTO supported_languages (code, name_key, name_native, is_active, is_default, sort_order)
  VALUES (p_code, p_name_key, p_name_native, p_is_active, p_is_default, p_sort_order)
  RETURNING *;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_supported_language(text, text, text, boolean, boolean, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_supported_language(text, text, text, boolean, boolean, integer) TO authenticated;
