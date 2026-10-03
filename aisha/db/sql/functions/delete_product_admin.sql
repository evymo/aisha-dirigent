-- Function: public.delete_product_admin
-- Arguments: p_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:24+01:00

CREATE OR REPLACE FUNCTION public.delete_product_admin(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  DELETE FROM products WHERE id = p_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'delete'::public.journal_action_type,
      p_area := 'shop'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_id::text,
      p_entity_type := 'product',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'warning'::public.journal_severity,
      p_summary := 'Deleted product',
      p_tags := ARRAY['admin', 'shop', 'product', 'delete'],
      p_user_id := auth.uid()
  );

  RETURN FOUND;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.delete_product_admin(p_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_product_admin(p_id uuid) TO authenticated;
