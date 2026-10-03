-- Function: public.get_token_reward_rules_localized
-- Arguments: p_locale TEXT (optional, defaults to 'en')
-- Description: Returns token reward rules with localized action names and descriptions.
--              Uses translation keys with fallback to English, then to legacy columns.
-- Security: STABLE - public read-only data.
-- @security: public
-- @audit: none

CREATE OR REPLACE FUNCTION public.get_token_reward_rules_localized(
  p_locale TEXT DEFAULT 'en'
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
  v_locale TEXT;
BEGIN
  -- Validate locale (supported: cs, de, en, fr, ru, th)
  v_locale := CASE
    WHEN p_locale IN ('cs', 'de', 'en', 'fr', 'ru', 'th') THEN p_locale
    ELSE 'en'
  END;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', trr.id,
      'action_type', trr.action_type,
      'token_type', trr.token_type,
      'action_name', public.get_translation_value_with_fallback(
        trr.action_name_key, 'rewards', v_locale, 'en', NULL
      ),
      'description', public.get_translation_value_with_fallback(
        trr.description_key, 'rewards', v_locale, 'en', NULL
      ),
      'base_amount', trr.base_amount,
      'multiplier', trr.multiplier,
      'min_amount', trr.min_amount,
      'max_amount', trr.max_amount,
      'daily_limit', trr.daily_limit,
      'weekly_limit', trr.weekly_limit,
      'monthly_limit', trr.monthly_limit,
      'cooldown_hours', trr.cooldown_hours,
      'requires_membership', trr.requires_membership,
      'membership_tier_required', trr.membership_tier_required,
      'is_active', trr.is_active,
      'sort_order', trr.sort_order
    ) ORDER BY trr.sort_order
  )
  INTO v_result
  FROM token_reward_rules trr
  WHERE trr.is_active = true;

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_token_reward_rules_localized(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_token_reward_rules_localized(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_token_reward_rules_localized(TEXT) TO anon;
