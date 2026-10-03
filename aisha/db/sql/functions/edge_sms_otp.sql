-- Function: public.edge_sms_otp
-- Purpose: Edge-safe OTP reads and writes.

CREATE OR REPLACE FUNCTION public.edge_sms_otp(
  p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_phone text;
  v_code text;
  v_hash text;
  v_row record;
  v_row_json jsonb;
  v_attempts integer;
BEGIN
  IF p_action = 'upsert' THEN
    v_phone := NULLIF(p_payload ->> 'phone', '');
    v_code := NULLIF(p_payload ->> 'code', '');
    IF v_phone IS NULL THEN
      RAISE EXCEPTION 'Missing phone';
    END IF;
    IF v_code IS NULL THEN
      RAISE EXCEPTION 'Missing code';
    END IF;

    v_hash := extensions.crypt(v_code, extensions.gen_salt('bf'));

    INSERT INTO public.sms_otp_codes (
      code_hash,
      expires_at,
      phone,
      verified
    )
    VALUES (
      v_hash,
      NULLIF(p_payload ->> 'expires_at', '')::timestamptz,
      v_phone,
      COALESCE((p_payload ->> 'verified')::boolean, false)
    )
    ON CONFLICT (phone) DO UPDATE
    SET
      attempts = 0,
      code_hash = EXCLUDED.code_hash,
      expires_at = EXCLUDED.expires_at,
      updated_at = now(),
      verified = EXCLUDED.verified;

    RETURN jsonb_build_object('ok', true);
  END IF;

  IF p_action = 'verify' THEN
    v_phone := NULLIF(p_payload ->> 'phone', '');
    v_code := NULLIF(p_payload ->> 'code', '');
    IF v_phone IS NULL THEN
      RAISE EXCEPTION 'Missing phone';
    END IF;
    IF v_code IS NULL THEN
      RAISE EXCEPTION 'Missing code';
    END IF;

    SELECT
      s.attempts,
      s.code_hash,
      s.expires_at,
      s.verified
    INTO v_row
    FROM public.sms_otp_codes s
    WHERE s.phone = v_phone
    LIMIT 1;

    IF v_row IS NULL THEN
      RETURN jsonb_build_object('valid', false, 'error', 'not_found');
    END IF;

    IF v_row.verified THEN
      RETURN jsonb_build_object('valid', false, 'error', 'already_used');
    END IF;

    IF v_row.expires_at < now() THEN
      RETURN jsonb_build_object('valid', false, 'error', 'expired');
    END IF;

    IF COALESCE(v_row.attempts, 0) >= 3 THEN
      UPDATE public.sms_otp_codes
      SET verified = true, updated_at = now()
      WHERE phone = v_phone;
      RETURN jsonb_build_object('valid', false, 'error', 'max_attempts');
    END IF;

    IF extensions.crypt(v_code, v_row.code_hash) = v_row.code_hash THEN
      UPDATE public.sms_otp_codes
      SET verified = true, updated_at = now()
      WHERE phone = v_phone;
      RETURN jsonb_build_object('valid', true);
    END IF;

    v_attempts := COALESCE(v_row.attempts, 0) + 1;
    UPDATE public.sms_otp_codes
    SET attempts = v_attempts, updated_at = now()
    WHERE phone = v_phone;

    IF v_attempts >= 3 THEN
      UPDATE public.sms_otp_codes
      SET verified = true, updated_at = now()
      WHERE phone = v_phone;
      RETURN jsonb_build_object(
        'valid', false,
        'error', 'max_attempts',
        'attempts_remaining', 0
      );
    END IF;

    RETURN jsonb_build_object(
      'valid', false,
      'error', 'invalid_code',
      'attempts_remaining', 3 - v_attempts
    );
  END IF;

  IF p_action = 'get' THEN
    v_phone := NULLIF(p_payload ->> 'phone', '');
    IF v_phone IS NULL THEN
      RAISE EXCEPTION 'Missing phone';
    END IF;

    SELECT jsonb_build_object(
      'attempts', s.attempts,
      'expires_at', s.expires_at,
      'phone', s.phone,
      'verified', s.verified
    )
    INTO v_row_json
    FROM public.sms_otp_codes s
    WHERE s.phone = v_phone
    LIMIT 1;

    RETURN jsonb_build_object('row', v_row_json);
  END IF;

  IF p_action = 'update' THEN
    v_phone := NULLIF(p_payload ->> 'phone', '');
    IF v_phone IS NULL THEN
      RAISE EXCEPTION 'Missing phone';
    END IF;

    UPDATE public.sms_otp_codes
    SET
      attempts = CASE WHEN p_payload ? 'attempts' THEN NULLIF(p_payload ->> 'attempts', '')::integer ELSE attempts END,
      updated_at = now(),
      verified = CASE WHEN p_payload ? 'verified' THEN (p_payload ->> 'verified')::boolean ELSE verified END
    WHERE phone = v_phone;

    RETURN jsonb_build_object('ok', true, 'updated', FOUND);
  END IF;

  RAISE EXCEPTION 'Unsupported action: %', p_action;
END;
$function$;

REVOKE ALL ON FUNCTION public.edge_sms_otp(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edge_sms_otp(text, jsonb) TO service_role;
