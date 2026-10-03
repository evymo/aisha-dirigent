-- Function: public.update_order_status_admin
-- Arguments: p_order_id uuid, p_status text, p_notes text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:22+01:00

CREATE OR REPLACE FUNCTION public.update_order_status_admin(p_order_id uuid, p_status text, p_notes text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old_status text;
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  SELECT status INTO v_old_status FROM orders WHERE id = p_order_id;

  UPDATE orders SET
    status = p_status,
    delivered_at = CASE WHEN p_status = 'delivered' THEN now() ELSE delivered_at END,
    updated_at = now()
  WHERE id = p_order_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := 'commerce'::journal_area,
      p_entity_id := p_order_id::text,
      p_entity_type := 'order',
      p_severity := 'info'::journal_severity,
      p_summary := format('Order status changed from %s to %s', v_old_status, p_status),
    p_user_id := auth.uid()
  );

  RETURN FOUND;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_order_status_admin(p_order_id uuid, p_status text, p_notes text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_order_status_admin(p_order_id uuid, p_status text, p_notes text) TO authenticated;
