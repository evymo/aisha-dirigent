-- Function: public.get_my_orders_audited
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:00+01:00

CREATE OR REPLACE FUNCTION public.get_my_orders_audited()
 RETURNS TABLE(id uuid, user_id uuid, total numeric, subtotal numeric, shipping numeric, currency text, status text, shipping_address jsonb, billing_address jsonb, stripe_payment_intent_id text, delivered_at timestamptz, created_at timestamptz, updated_at timestamptz, order_items jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'view'::journal_action_type,
      p_area := 'commerce'::journal_area,
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'orders',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info'::journal_severity,
      p_summary := 'User viewed their orders',
      p_tags := ARRAY['order', 'commerce', 'list'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT 
    o.id, o.user_id, o.total, o.subtotal, o.shipping, o.currency, o.status, o.shipping_address, o.billing_address,
    o.stripe_payment_intent_id, o.delivered_at, o.created_at, o.updated_at,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', oi.id, 'product_id', oi.product_id, 'quantity', oi.quantity,
        'price_at_purchase', oi.price_at_purchase,
        'product', (SELECT jsonb_build_object('name', p.name, 'slug', p.slug, 'image_url', p.image_url) FROM products p WHERE p.id = oi.product_id)
      ))
      FROM order_items oi WHERE oi.order_id = o.id
    ), '[]'::JSONB) as order_items
  FROM orders o
  WHERE o.user_id = auth.uid()
  ORDER BY o.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_orders_audited() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_orders_audited() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_orders_audited() TO authenticated;
