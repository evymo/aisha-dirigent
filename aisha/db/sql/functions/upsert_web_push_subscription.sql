-- Function: public.upsert_web_push_subscription
-- Arguments: p_subscription jsonb
-- Description: Upsert current browser push subscription for authenticated user.
-- Security: SECURITY DEFINER (uses auth.uid()).
-- ⛔ VLASTNICTVÍ ENDPOINTU (2026-09-29): `endpoint` je globální klíč. Dřív
--    `ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id` — kdokoli
--    přihlášený, kdo znal cizí endpoint, ho převzal (notifikace oběti šly jemu
--    zpět do prohlížeče oběti pod jeho účtem, oběť svoje přestala dostávat).
--    Převzít cizí endpoint smí jen DRŽITEL téže subscription: shodné `p256dh`
--    a `auth` zná jen prohlížeč, který ji vytvořil (legitimní případ: na témž
--    prohlížeči se odhlásí A a přihlásí B). Samotný endpoint → 42501. Vlastní
--    řádek se aktualizuje jako dřív. Stráž je dvojí: kontrola předem (čitelná
--    chyba) a podmínka v DO UPDATE (atomicky).

CREATE OR REPLACE FUNCTION public.upsert_web_push_subscription(
  p_subscription jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_id uuid;
  v_endpoint text;
  v_p256dh text;
  v_auth text;
  v_expiration_time timestamptz;
  v_user_agent text;
  v_locale text;
  v_timezone text;
  v_vlastnik uuid;
  v_drzitel boolean;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_endpoint := NULLIF(trim(p_subscription ->> 'endpoint'), '');
  v_p256dh := NULLIF(trim(p_subscription #>> '{keys,p256dh}'), '');
  v_auth := NULLIF(trim(p_subscription #>> '{keys,auth}'), '');
  v_user_agent := NULLIF(trim(p_subscription ->> 'userAgent'), '');
  v_locale := NULLIF(trim(p_subscription ->> 'locale'), '');
  v_timezone := NULLIF(trim(p_subscription ->> 'timezone'), '');
  v_expiration_time := NULL;

  IF v_endpoint IS NULL OR v_p256dh IS NULL OR v_auth IS NULL THEN
    RAISE EXCEPTION 'Invalid subscription payload' USING ERRCODE = '22023';
  END IF;

  IF p_subscription ? 'expirationTime' THEN
    BEGIN
      IF jsonb_typeof(p_subscription -> 'expirationTime') = 'number' THEN
        v_expiration_time := to_timestamp((p_subscription ->> 'expirationTime')::double precision / 1000.0);
      ELSIF jsonb_typeof(p_subscription -> 'expirationTime') = 'string'
        AND NULLIF(trim(p_subscription ->> 'expirationTime'), '') IS NOT NULL THEN
        v_expiration_time := to_timestamp((p_subscription ->> 'expirationTime')::double precision / 1000.0);
      END IF;
    EXCEPTION
      WHEN others THEN
        v_expiration_time := NULL;
    END;
  END IF;

  SELECT w.user_id, (w.p256dh = v_p256dh AND w.auth = v_auth)
    INTO v_vlastnik, v_drzitel
    FROM public.web_push_subscriptions w
   WHERE w.endpoint = v_endpoint
   FOR UPDATE;
  IF FOUND AND v_vlastnik IS DISTINCT FROM v_user_id AND NOT v_drzitel THEN
    RAISE EXCEPTION 'push endpoint belongs to another user' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.web_push_subscriptions (
    user_id,
    endpoint,
    p256dh,
    auth,
    expiration_time,
    user_agent,
    locale,
    timezone,
    is_active,
    last_seen_at,
    last_error_at,
    last_error_reason,
    updated_at
  )
  VALUES (
    v_user_id,
    v_endpoint,
    v_p256dh,
    v_auth,
    v_expiration_time,
    v_user_agent,
    v_locale,
    v_timezone,
    true,
    now(),
    NULL,
    NULL,
    now()
  )
  ON CONFLICT (endpoint) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    p256dh = EXCLUDED.p256dh,
    auth = EXCLUDED.auth,
    expiration_time = EXCLUDED.expiration_time,
    user_agent = COALESCE(EXCLUDED.user_agent, public.web_push_subscriptions.user_agent),
    locale = COALESCE(EXCLUDED.locale, public.web_push_subscriptions.locale),
    timezone = COALESCE(EXCLUDED.timezone, public.web_push_subscriptions.timezone),
    is_active = true,
    last_seen_at = now(),
    last_error_at = NULL,
    last_error_reason = NULL,
    updated_at = now()
  WHERE public.web_push_subscriptions.user_id = EXCLUDED.user_id
     OR (public.web_push_subscriptions.p256dh = EXCLUDED.p256dh
         AND public.web_push_subscriptions.auth = EXCLUDED.auth)
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    -- Souběh: řádek změnil vlastníka mezi kontrolou a zápisem — nic se nepřevzalo.
    RAISE EXCEPTION 'push endpoint belongs to another user' USING ERRCODE = '42501';
  END IF;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_web_push_subscription(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_web_push_subscription(jsonb) TO authenticated;
