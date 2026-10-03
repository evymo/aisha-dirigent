-- Function: public.create_subscription_package_admin
-- Arguments: p_name text, p_code text, p_description text, p_price numeric, p_period text, p_features jsonb, p_is_active boolean, p_display_order integer, p_tier membership_tier, p_currency text, p_tokens_governance integer, p_tokens_impact integer, p_tokens_data integer, p_is_recurring boolean, p_stripe_price_id text
-- Description: Create a new subscription package. Admin/staff only.
-- Security: SECURITY DEFINER, admin/staff only
-- Updated: 2026-01-11 - Synced param names with DB: p_tokens_governance, p_tokens_impact

CREATE OR REPLACE FUNCTION public.create_subscription_package_admin(
  p_name text, 
  p_code text, 
  p_description text DEFAULT NULL, 
  p_price numeric DEFAULT 0, 
  p_period text DEFAULT 'monthly', 
  p_features jsonb DEFAULT '[]'::jsonb, 
  p_is_active boolean DEFAULT true, 
  p_display_order integer DEFAULT 0, 
  p_tier membership_tier DEFAULT 'basic', 
  p_currency text DEFAULT public.commerce_base_currency(), 
  p_tokens_governance integer DEFAULT 0, 
  p_tokens_impact integer DEFAULT 0, 
  p_tokens_data integer DEFAULT 0, 
  p_is_recurring boolean DEFAULT false, 
  p_stripe_price_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  INSERT INTO public.subscription_packages (
    name,
    slug,
    description,
    tier,
    period,
    price,
    currency,
    features,
    tokens_governance,
    tokens_impact,
    tokens_data,
    governance_tokens,
    impact_tokens,
    is_active,
    is_recurring,
    sort_order,
    stripe_price_id
  ) VALUES (
    p_name,
    p_code,
    p_description,
    p_tier,
    p_period::public.subscription_period,
    p_price,
    upper(p_currency),
    COALESCE(p_features, '[]'::jsonb),
    COALESCE(p_tokens_governance, 0),
    COALESCE(p_tokens_impact, 0),
    COALESCE(p_tokens_data, 0),
    COALESCE(p_tokens_governance, 0),
    COALESCE(p_tokens_impact, 0),
    COALESCE(p_is_active, true),
    COALESCE(p_is_recurring, false),
    COALESCE(p_display_order, 0),
    p_stripe_price_id
  )
  RETURNING id INTO v_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'create'::public.journal_action_type,
      p_area := 'admin'::public.journal_area,
      p_details := NULL,
      p_entity_id := v_id::text,
      p_entity_type := 'subscription_package',
      p_new_values := jsonb_build_object('name', p_name, 'code', p_code),
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Created subscription package: ' || p_name,
      p_tags := ARRAY['admin', 'subscription', 'create'],
      p_user_id := auth.uid()
  );

  RETURN v_id;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.create_subscription_package_admin(text, text, text, numeric, text, jsonb, boolean, integer, membership_tier, text, integer, integer, integer, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_subscription_package_admin(text, text, text, numeric, text, jsonb, boolean, integer, membership_tier, text, integer, integer, integer, boolean, text) TO authenticated;
