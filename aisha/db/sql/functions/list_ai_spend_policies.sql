-- ============================================================================
-- Source of Truth: list_ai_spend_policies
-- Purpose: Mission Control SpendPolicyCard — policies joined with the cost
--          class catalog so the editor shows both the user thresholds and
--          the zero-config defaults they override.
-- Security: SECURITY DEFINER, admin/staff read.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.list_ai_spend_policies()
RETURNS TABLE (
  policy_id            uuid,
  scope_type           text,
  scope_id             uuid,
  story_title          text,
  task_kind            text,
  auto_allow_under numeric,
  ask_over         numeric,
  deny_over        numeric,
  is_active            boolean,
  updated_at           timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    sp.id          AS policy_id,
    sp.scope_type,
    sp.scope_id,
    ps.title       AS story_title,
    sp.task_kind,
    sp.auto_allow_under,
    sp.ask_over,
    sp.deny_over,
    sp.is_active,
    sp.updated_at
  FROM public.ai_spend_policies sp
  LEFT JOIN public.partner_stories ps
    ON sp.scope_type = 'story' AND ps.id = sp.scope_id
  ORDER BY sp.scope_type, sp.task_kind NULLS FIRST, sp.updated_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_ai_spend_policies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_ai_spend_policies() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_ai_spend_policies() TO service_role;

COMMENT ON FUNCTION public.list_ai_spend_policies() IS
  'All spend policy rows (incl. inactive) with story titles for the Mission Control policy editor. Admin/staff only.';
