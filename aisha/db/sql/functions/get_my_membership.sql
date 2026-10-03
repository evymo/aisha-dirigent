-- Function: public.get_my_membership
-- Arguments: (none)
-- Description: The caller's current membership, including all four token balances.
-- Security: SECURITY DEFINER, row_security ON, scoped to auth.uid(). STABLE, read-only.
--
-- 2026-07-15 FIX — this RETURNS TABLE omitted tokens_aisha while memberships has FOUR
-- token columns, and src/lib/schemas/hookSchemas.ts:28 declares
--   tokens_aisha: z.number().nullable()
-- .nullable() permits a null VALUE, not an ABSENT KEY (that is .optional()). So the row
-- this function returned failed the schema with {"path":["tokens_aisha"],"message":"Required"},
-- parseFirstItemSafe swallowed the ZodError and returned null, and **membership was null for
-- every web user in production** — silently. useTokens() reads
-- `membership?.tokens_aisha || 0`, so every balance rendered as 0 and every
-- membership-gated surface rendered empty, with nothing red anywhere.
--
-- The safeParse-returns-null shape is why nobody saw it: a fallback that hides a broken
-- contract instead of failing loud. The contract is fixed here, at the source.
--
-- Keep this projection in step with memberships' token columns. The role decoupling renames
-- tokens_aisha -> tokens_utility; this function moves with it.

CREATE OR REPLACE FUNCTION public.get_my_membership()
 RETURNS TABLE(id uuid, user_id uuid, tier membership_tier, status membership_status, payment_type payment_type, subscription_period subscription_period, stripe_subscription_id text, stripe_customer_id text, starts_at timestamptz, expires_at timestamptz, auto_renew boolean, tokens_aisha integer, tokens_governance integer, tokens_impact integer, tokens_data integer, notes text, created_at timestamptz, updated_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'on'
AS $function$
  SELECT
    m.id,
    m.user_id,
    m.tier,
    m.status,
    m.payment_type,
    m.subscription_period,
    m.stripe_subscription_id,
    m.stripe_customer_id,
    m.starts_at,
    m.expires_at,
    m.auto_renew,
    m.tokens_aisha,
    m.tokens_governance,
    m.tokens_impact,
    m.tokens_data,
    m.notes,
    m.created_at,
    m.updated_at
  FROM public.memberships m
  WHERE m.user_id = auth.uid()
  ORDER BY m.created_at DESC
  LIMIT 1;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_membership() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_membership() TO authenticated;
