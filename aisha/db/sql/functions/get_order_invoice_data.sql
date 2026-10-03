-- get_order_invoice_data: Fetch full order data for invoice PDF rendering
-- Available to order owner (member) and admins
CREATE OR REPLACE FUNCTION public.get_order_invoice_data(
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_order_user_id uuid;
  v_is_admin boolean;
  v_result jsonb;
BEGIN
  -- Get order owner
  SELECT o.user_id INTO v_order_user_id
  FROM public.orders o WHERE o.id = p_order_id;

  IF v_order_user_id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Authorization: order owner or admin
  v_is_admin := public.has_role(v_user_id, 'admin');
  IF v_user_id != v_order_user_id AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Build invoice data
  SELECT jsonb_build_object(
    'id', o.id,
    'billing_address', o.billing_address,
    'created_at', o.created_at,
    'currency', o.currency,
    'invoice_generated_at', o.invoice_generated_at,
    'invoice_number', o.invoice_number,
    'order_items', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', oi.id,
        'price_at_purchase', oi.price_at_purchase,
        'product_id', oi.product_id,
        'product_name', p.name,
        'product_sku', p.sku,
        'quantity', oi.quantity
      ))
      FROM public.order_items oi
      LEFT JOIN public.products p ON p.id = oi.product_id
      WHERE oi.order_id = o.id),
      '[]'::jsonb
    ),
    'payment_method', o.payment_method,
    'shipping', o.shipping,
    'shipping_address', o.shipping_address,
    'shipping_method', o.shipping_method,
    'status', o.status,
    'subtotal', o.subtotal,
    'tax', o.tax,
    'total', o.total,
    'user_email', (SELECT email FROM aisha_auth.users WHERE id = o.user_id),
    'user_name', (SELECT display_name FROM public.profiles WHERE user_id = o.user_id),
    'variable_symbol', o.variable_symbol
  )
  INTO v_result
  FROM public.orders o
  WHERE o.id = p_order_id;

  -- Audit log
  PERFORM public.write_audit_journal(
    p_action_type := 'view',
    p_area := CASE WHEN v_is_admin THEN 'admin' ELSE 'member' END,
    p_details := jsonb_build_object('has_invoice', v_result ->> 'invoice_number' IS NOT NULL),
    p_entity_id := p_order_id::text,
    p_entity_type := 'invoice',
    p_new_values := NULL,
    p_old_values := NULL,
    p_severity := 'info',
    p_summary := 'Invoice data accessed',
    p_tags := ARRAY['invoice', 'orders'],
    p_user_id := v_user_id
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_order_invoice_data(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_invoice_data(uuid) TO authenticated;
