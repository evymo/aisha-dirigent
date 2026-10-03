-- Function: public.get_product_access_type
-- Arguments: p_product_id uuid
-- Description: Returns the access tier the caller has for a given product.
-- Returns: TEXT — one of:
--   'view'         — caller is not authenticated; can browse only
--   'auto_approve' — caller has an active upgraded (paid) membership
--   'order'        — caller has member or partner role (regular checkout)
--   'preorder'     — fallback: authenticated but no member/partner role
-- Possible values: 'view' | 'auto_approve' | 'order' | 'preorder'
-- Note: p_product_id is currently unused but kept for forward compatibility
--   (future per-product entitlement rules).
-- Security: SECURITY DEFINER, search_path 'public'. Granted to authenticated.
-- Extracted: 2026-01-08T18:27:19+01:00

CREATE OR REPLACE FUNCTION public.get_product_access_type(p_product_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_has_member_role boolean;
  v_has_partner_role boolean;
  v_membership_tier text;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RETURN 'view';
  END IF;

  v_has_member_role := has_role(v_user_id, 'member');
  v_has_partner_role := has_role(v_user_id, 'partner');

  SELECT tier::text INTO v_membership_tier
  FROM memberships
  WHERE user_id = v_user_id AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;

  -- 'upgraded' is the paid membership tier in the membership_tier enum
  -- (basic | upgraded | trial). The prior 'premium'/'vip' check could never match,
  -- so auto_approve was dead — a paid member was silently downgraded to 'order'.
  IF v_membership_tier = 'upgraded' THEN
    RETURN 'auto_approve';
  END IF;

  IF v_has_member_role OR v_has_partner_role THEN
    RETURN 'order';
  END IF;

  RETURN 'preorder';
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_product_access_type(p_product_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_access_type(p_product_id uuid) TO authenticated;
