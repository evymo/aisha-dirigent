-- Function: public.delete_product_catalog_admin
-- Arguments: p_id uuid
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.delete_product_catalog_admin(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_code TEXT;
BEGIN
  -- Authorization: admin only
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  -- Soft delete (deactivate)
  UPDATE product_catalog
  SET is_active = false, updated_at = now()
  WHERE id = p_id
  RETURNING code INTO v_code;

  IF v_code IS NULL THEN
    RETURN false;
  END IF;

  -- Audit
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'CATALOG_DELETE',
    jsonb_build_object(
      'area', 'product_catalog',
      'severity', 'warning',
      'entity_type', 'product_catalog',
      'entity_id', p_id,
      'code', v_code
    )
  );

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_product_catalog_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_product_catalog_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_product_catalog_admin(uuid) TO service_role;
