-- Function: public.update_supported_language
-- Arguments: p_code text, p_is_active boolean, p_is_default boolean, p_name_key text, p_name_native text, p_sort_order integer
-- Description: Updates a supported language entry. Admin only.
-- Security: SECURITY DEFINER with admin guard.
-- @admin: true

CREATE OR REPLACE FUNCTION public.update_supported_language(
  p_code text,
  p_is_active boolean DEFAULT NULL::boolean,
  p_is_default boolean DEFAULT NULL::boolean,
  p_name_key text DEFAULT NULL::text,
  p_name_native text DEFAULT NULL::text,
  p_sort_order integer DEFAULT NULL::integer
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
  UPDATE supported_languages
  SET 
    is_active = COALESCE(p_is_active, is_active),
    is_default = COALESCE(p_is_default, is_default),
    name_key = COALESCE(p_name_key, name_key),
    name_native = COALESCE(p_name_native, name_native),
    sort_order = COALESCE(p_sort_order, sort_order),
    updated_at = now()
  WHERE code = p_code
  RETURNING *;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_supported_language(text, boolean, boolean, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_supported_language(text, boolean, boolean, text, text, integer) TO authenticated;
