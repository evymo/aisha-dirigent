-- Function: public.get_subscription_packages_admin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:38+01:00

-- A currency-suffixed name (`*_usd`) was removed from this function's signature.
-- The TYPES did not change, so CREATE OR REPLACE matches the deployed function and
-- Postgres refuses to rename in place ("cannot change name of input parameter", or
-- "cannot change return type" when the renamed name is a RETURNS TABLE column).
-- DROP-first is the convention used elsewhere in this directory; the REVOKE/GRANT
-- below re-applies whatever privileges the drop clears.
DROP FUNCTION IF EXISTS public.get_subscription_packages_admin();

CREATE OR REPLACE FUNCTION public.get_subscription_packages_admin()
 RETURNS TABLE(created_at timestamptz, currency text, description text, governance_tokens integer, id uuid, impact_tokens integer, is_active boolean, is_recurring boolean, name text, period text, price numeric, slug text, sort_order integer, stripe_price_id text, tier text, tokens_governance integer, tokens_impact integer, tokens_data integer, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;


  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'read'::public.journal_action_type,
      p_area := 'subscriptions'::public.journal_area,
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'subscription_package',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read subscription package',
      p_tags := ARRAY['admin', 'subscription_package'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    sp.created_at,
    COALESCE(sp.currency, public.commerce_base_currency()) AS currency,
    COALESCE(sp.description, '') AS description,
    COALESCE(sp.governance_tokens, 0) AS governance_tokens,
    sp.id,
    COALESCE(sp.impact_tokens, 0) AS impact_tokens,
    COALESCE(sp.is_active, true) AS is_active,
    COALESCE(sp.is_recurring, false) AS is_recurring,
    sp.name,
    sp.period::text,
    sp.price,
    sp.slug,
    COALESCE(sp.sort_order, 0) AS sort_order,
    COALESCE(sp.stripe_price_id, '') AS stripe_price_id,
    sp.tier::text,
    sp.tokens_governance,
    sp.tokens_impact,
    sp.tokens_data,
    sp.updated_at
  FROM public.subscription_packages sp
  ORDER BY COALESCE(sp.sort_order, 0), sp.name;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_subscription_packages_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_subscription_packages_admin() TO authenticated;
