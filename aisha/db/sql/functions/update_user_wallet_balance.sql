-- Function: public.update_user_wallet_balance
-- Trigger helper: keeps user_wallets in sync with token_transactions inserts.

CREATE OR REPLACE FUNCTION public.update_user_wallet_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.user_id IS NULL OR NEW.token_type IS NULL OR NEW.amount IS NULL THEN
    RETURN NEW;
  END IF;

  -- D4: 'aisha' is a first-class balance column — it must NOT be dropped on the
  -- floor. The accepted set includes every wallet token type.
  IF NEW.token_type NOT IN ('governance', 'impact', 'data', 'aisha') THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.user_wallets (
    user_id,
    governance_tokens,
    impact_tokens,
    data_tokens,
    aisha_tokens,
    created_at,
    updated_at
  )
  VALUES (
    NEW.user_id,
    CASE WHEN NEW.token_type = 'governance' THEN NEW.amount ELSE 0 END,
    CASE WHEN NEW.token_type = 'impact' THEN NEW.amount ELSE 0 END,
    CASE WHEN NEW.token_type = 'data' THEN NEW.amount ELSE 0 END,
    CASE WHEN NEW.token_type = 'aisha' THEN NEW.amount ELSE 0 END,
    now(),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    governance_tokens = public.user_wallets.governance_tokens + CASE WHEN NEW.token_type = 'governance' THEN NEW.amount ELSE 0 END,
    impact_tokens = public.user_wallets.impact_tokens + CASE WHEN NEW.token_type = 'impact' THEN NEW.amount ELSE 0 END,
    data_tokens = public.user_wallets.data_tokens + CASE WHEN NEW.token_type = 'data' THEN NEW.amount ELSE 0 END,
    aisha_tokens = public.user_wallets.aisha_tokens + CASE WHEN NEW.token_type = 'aisha' THEN NEW.amount ELSE 0 END,
    updated_at = now();

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_user_wallet_balance() FROM PUBLIC;
