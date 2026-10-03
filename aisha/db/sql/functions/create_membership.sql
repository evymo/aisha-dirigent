-- Function: public.create_membership
-- Arguments: p_tier membership_tier
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:05+01:00

CREATE OR REPLACE FUNCTION public.create_membership(p_tier membership_tier DEFAULT 'basic'::membership_tier)
 RETURNS TABLE(id uuid, user_id uuid, tier membership_tier, status membership_status, payment_type payment_type, subscription_period subscription_period, stripe_subscription_id text, stripe_customer_id text, starts_at timestamptz, expires_at timestamptz, auto_renew boolean, tokens_governance integer, tokens_impact integer, tokens_data integer, notes text, created_at timestamptz, updated_at timestamptz)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
    v_id UUID;
    v_tier membership_tier := p_tier;
BEGIN
    -- Self-service cannot self-grant a paid tier: this function is SECURITY INVOKER
    -- and only requires the authenticated role, so without this a member could create
    -- their own 'upgraded' membership for free. Paid tiers must come from the
    -- subscription->membership bridge (admin activation). Non-admins are coerced to
    -- 'basic'; admin/staff may still create any tier directly.
    IF v_tier <> 'basic'::membership_tier AND NOT public.is_admin_or_staff(auth.uid()) THEN
      v_tier := 'basic'::membership_tier;
    END IF;

    INSERT INTO public.memberships (user_id, tier, status, payment_type, starts_at)
    VALUES (auth.uid(), v_tier, 'active', 'one_time', NOW())
    RETURNING memberships.id INTO v_id;

    RETURN QUERY SELECT m.id, m.user_id, m.tier, m.status, m.payment_type, m.subscription_period,
           m.stripe_subscription_id, m.stripe_customer_id, m.starts_at, m.expires_at,
           m.auto_renew, m.tokens_governance, m.tokens_impact, m.tokens_data,
           m.notes, m.created_at, m.updated_at
    FROM public.memberships m WHERE m.id = v_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_membership(p_tier membership_tier) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_membership(p_tier membership_tier) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_membership(p_tier membership_tier) TO authenticated;
