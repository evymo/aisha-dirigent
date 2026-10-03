-- Function: public.update_subscription_package_admin
-- Arguments: p_id uuid, p_name text, p_code text, p_description text, p_price numeric, p_period text, p_features jsonb, p_is_active boolean, p_display_order integer, p_tier membership_tier, p_currency text, p_tokens_governance integer, p_tokens_impact integer, p_tokens_data integer, p_is_recurring boolean, p_stripe_price_id text
-- Description: Update a subscription package. Admin/staff only.
-- Security: SECURITY DEFINER, admin/staff only
-- Updated: 2026-01-11 - Synced param names with DB: p_tokens_governance, p_tokens_impact

CREATE OR REPLACE FUNCTION public.update_subscription_package_admin(
  p_id uuid, 
  p_name text DEFAULT NULL, 
  p_code text DEFAULT NULL, 
  p_description text DEFAULT NULL, 
  p_price numeric DEFAULT NULL, 
  p_period text DEFAULT NULL, 
  p_features jsonb DEFAULT NULL, 
  p_is_active boolean DEFAULT NULL, 
  p_display_order integer DEFAULT NULL, 
  p_tier membership_tier DEFAULT NULL, 
  p_currency text DEFAULT NULL, 
  p_tokens_governance integer DEFAULT NULL, 
  p_tokens_impact integer DEFAULT NULL, 
  p_tokens_data integer DEFAULT NULL, 
  p_is_recurring boolean DEFAULT NULL, 
  p_stripe_price_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_price numeric;
  v_currency text;
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  SELECT sp.price, sp.currency
  INTO v_price, v_currency
  FROM public.subscription_packages sp
  WHERE sp.id = p_id;

  v_price := COALESCE(p_price, v_price);
  v_currency := COALESCE(upper(p_currency), v_currency);

  UPDATE public.subscription_packages SET
    name = COALESCE(p_name, name),
    slug = COALESCE(p_code, slug),
    description = COALESCE(p_description, description),
    tier = COALESCE(p_tier, tier),
    period = CASE WHEN p_period IS NOT NULL THEN p_period::public.subscription_period ELSE period END,
    price = v_price,
    currency = v_currency,
    features = COALESCE(p_features, features),
    tokens_governance = COALESCE(p_tokens_governance, tokens_governance),
    tokens_impact = COALESCE(p_tokens_impact, tokens_impact),
    tokens_data = COALESCE(p_tokens_data, tokens_data),
    governance_tokens = COALESCE(p_tokens_governance, governance_tokens),
    impact_tokens = COALESCE(p_tokens_impact, impact_tokens),
    is_active = COALESCE(p_is_active, is_active),
    is_recurring = COALESCE(p_is_recurring, is_recurring),
    sort_order = COALESCE(p_display_order, sort_order),
    stripe_price_id = COALESCE(p_stripe_price_id, stripe_price_id),
    updated_at = now()
  WHERE id = p_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'update'::public.journal_action_type,
      p_area := 'admin'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_id::text,
      p_entity_type := 'subscription_package',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Updated subscription package',
      p_tags := ARRAY['admin', 'subscription', 'update'],
      p_user_id := auth.uid()
  );

  RETURN FOUND;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.update_subscription_package_admin(uuid, text, text, text, numeric, text, jsonb, boolean, integer, membership_tier, text, integer, integer, integer, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_subscription_package_admin(uuid, text, text, text, numeric, text, jsonb, boolean, integer, membership_tier, text, integer, integer, integer, boolean, text) TO authenticated;
