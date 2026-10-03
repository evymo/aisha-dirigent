-- Function: public.update_my_membership
-- Arguments: p_updates jsonb
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:19+01:00

CREATE OR REPLACE FUNCTION public.update_my_membership(p_updates jsonb)
 RETURNS TABLE(id uuid, user_id uuid, tier membership_tier, status membership_status, payment_type payment_type, subscription_period subscription_period, stripe_subscription_id text, stripe_customer_id text, starts_at timestamptz, expires_at timestamptz, auto_renew boolean, tokens_governance integer, tokens_impact integer, tokens_data integer, notes text, created_at timestamptz, updated_at timestamptz)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
    v_id UUID;
BEGIN
    SELECT m.id INTO v_id
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
    ORDER BY m.created_at DESC
    LIMIT 1;

    IF v_id IS NULL THEN
        RAISE EXCEPTION 'No membership found';
    END IF;

    UPDATE public.memberships SET
        auto_renew = COALESCE((p_updates->>'auto_renew')::BOOLEAN, auto_renew),
        notes = COALESCE(p_updates->>'notes', notes),
        updated_at = NOW()
    WHERE memberships.id = v_id;

    RETURN QUERY SELECT m.id, m.user_id, m.tier, m.status, m.payment_type, m.subscription_period,
           m.stripe_subscription_id, m.stripe_customer_id, m.starts_at, m.expires_at,
           m.auto_renew, m.tokens_governance, m.tokens_impact, m.tokens_data,
           m.notes, m.created_at, m.updated_at
    FROM public.memberships m WHERE m.id = v_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_my_membership(p_updates jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_my_membership(p_updates jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_my_membership(p_updates jsonb) TO authenticated;
