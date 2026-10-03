-- Function: public.mark_order_shipped_admin
-- Arguments: p_order_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:57+01:00

CREATE OR REPLACE FUNCTION public.mark_order_shipped_admin(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  UPDATE orders SET status = 'shipped', updated_at = now() WHERE id = p_order_id;

  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'update'::public.journal_action_type,
      p_area := 'orders'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_order_id::text,
      p_entity_type := 'order_shipped',
      p_new_values := jsonb_build_object('order_id', p_order_id),
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Admin updated order shipped',
      p_tags := ARRAY['admin', 'order_shipped', 'update'],
      p_user_id := auth.uid()
  );

END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.mark_order_shipped_admin(p_order_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_order_shipped_admin(p_order_id uuid) TO authenticated;
