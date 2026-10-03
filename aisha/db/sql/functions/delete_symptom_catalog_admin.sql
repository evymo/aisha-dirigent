-- Function: delete_symptom_catalog_admin
-- Purpose: Admin soft-delete (deactivate) symptom catalog entry
-- Access: admin only
-- Security: SECURITY DEFINER with authorization check + audit

CREATE OR REPLACE FUNCTION public.delete_symptom_catalog_admin(
  p_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_code TEXT;
BEGIN
  -- Authorization: admin only
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  -- Soft delete (deactivate)
  UPDATE symptom_catalog
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
      'area', 'symptom_catalog',
      'severity', 'warning',
      'entity_type', 'symptom_catalog',
      'entity_id', p_id,
      'code', v_code
    )
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_symptom_catalog_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_symptom_catalog_admin(uuid) TO authenticated;

COMMENT ON FUNCTION public.delete_symptom_catalog_admin(uuid) IS 'Admin: deactivate symptom catalog entry. Admin role required.';
