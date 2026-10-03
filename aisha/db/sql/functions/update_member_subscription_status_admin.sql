-- Function: public.update_member_subscription_status_admin
-- Arguments: p_subscription_id uuid, p_status text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:19+01:00

CREATE OR REPLACE FUNCTION public.update_member_subscription_status_admin(p_subscription_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  UPDATE member_subscriptions SET status = p_status WHERE id = p_subscription_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription not found: %', p_subscription_id;
  END IF;

  -- Bridge accounting -> entitlement. Activating a subscription previously left the
  -- member's tier untouched (member_subscriptions is a billing ledger; memberships is
  -- the entitlement). On activation, reflect the package tier onto the user's single
  -- membership (UNIQUE(user_id)) and link it back. Admin is the eligibility gate here
  -- (grandfathering allowed in beta); the RPC already requires admin/staff above.
  IF lower(p_status) = 'active' THEN
    WITH sub AS (
      SELECT ms.user_id, ms.period_end, sp.tier
      FROM public.member_subscriptions ms
      JOIN public.subscription_packages sp ON sp.id = ms.package_id
      WHERE ms.id = p_subscription_id
    ), up AS (
      INSERT INTO public.memberships (user_id, tier, status, starts_at, expires_at)
      SELECT user_id, tier, 'active'::public.membership_status, now(), period_end FROM sub
      ON CONFLICT (user_id) DO UPDATE SET
        tier = EXCLUDED.tier,
        status = 'active'::public.membership_status,
        expires_at = EXCLUDED.expires_at,
        updated_at = now()
      RETURNING id
    )
    UPDATE public.member_subscriptions
    SET membership_id = (SELECT id FROM up)
    WHERE id = p_subscription_id;
  END IF;

  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'update'::public.journal_action_type,
      p_area := 'subscriptions'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_subscription_id::text,
      p_entity_type := 'member_subscription_status',
      p_new_values := jsonb_build_object('subscription_id', p_subscription_id, 'status', p_status),
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Admin updated member subscription status',
      p_tags := ARRAY['admin', 'member_subscription_status', 'update'],
      p_user_id := auth.uid()
  );

END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_member_subscription_status_admin(p_subscription_id uuid, p_status text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_member_subscription_status_admin(p_subscription_id uuid, p_status text) TO authenticated;
