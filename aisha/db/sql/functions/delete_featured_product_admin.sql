-- Function: delete_featured_product_admin
-- Description: Delete featured product (admin only)
-- Security: SECURITY DEFINER with admin check + audit
-- Created: 2026-02-03

CREATE OR REPLACE FUNCTION delete_featured_product_admin(
  p_id uuid
)
RETURNS bool
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
BEGIN
  -- Authorization check
  IF NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'staff')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff role required';
  END IF;

  -- Delete
  DELETE FROM featured_products WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Featured product not found: %', p_id;
  END IF;

  -- Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'ADMIN_DELETE',
    jsonb_build_object(
      'area', 'featured_products',
      'entity_id', p_id,
      'severity', 'warning'
    )
  );

  RETURN true;
END;
$$;

-- Security
REVOKE ALL ON FUNCTION delete_featured_product_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_featured_product_admin(uuid) TO authenticated;

COMMENT ON FUNCTION delete_featured_product_admin(uuid) IS 'Delete featured product configuration (admin only)';
