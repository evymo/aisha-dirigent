-- Function: public.edge_profiles
-- Purpose: Edge-safe profile access helpers.

CREATE OR REPLACE FUNCTION public.edge_profiles(
  p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_user_id uuid;
  v_rows jsonb;
  v_stripe_customer_id text;
  v_user_id uuid;
BEGIN
  v_actor_user_id := auth.uid();

  IF auth.role() <> 'service_role' THEN
    IF v_actor_user_id IS NULL THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;

    IF NOT public.has_role(v_actor_user_id, 'admin') AND NOT public.has_role(v_actor_user_id, 'staff') THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  END IF;

  IF p_action = 'get_languages' THEN
    RETURN jsonb_build_object(
      'rows',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'preferred_language', p.preferred_language,
              'user_id', p.user_id
            )
          )
          FROM public.profiles p
          WHERE p.user_id = ANY(
            COALESCE(
              (
                SELECT array_agg(value::uuid)
                FROM jsonb_array_elements_text(COALESCE(p_payload -> 'user_ids', '[]'::jsonb)) AS t(value)
              ),
              ARRAY[]::uuid[]
            )
          )
        ),
        '[]'::jsonb
      )
    );
  END IF;

  IF p_action = 'get_user_ids' THEN
    RETURN jsonb_build_object(
      'rows',
      COALESCE(
        (
          SELECT jsonb_agg(jsonb_build_object('user_id', p.user_id))
          FROM public.profiles p
          WHERE p.user_id IS NOT NULL
        ),
        '[]'::jsonb
      )
    );
  END IF;

  IF p_action = 'get_user_profile' THEN
    v_user_id := NULLIF(p_payload ->> 'user_id', '')::uuid;

    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'Missing user_id';
    END IF;

    SELECT jsonb_build_object(
      'email', p.email,
      'first_name', p.first_name,
      'last_name', p.last_name,
      'preferred_language', p.preferred_language,
      'stripe_customer_id', p.stripe_customer_id,
      'user_id', p.user_id
    )
    INTO v_rows
    FROM public.profiles p
    WHERE p.user_id = v_user_id;

    RETURN jsonb_build_object('row', v_rows);
  END IF;

  IF p_action = 'set_stripe_customer' THEN
    v_user_id := NULLIF(p_payload ->> 'user_id', '')::uuid;
    v_stripe_customer_id := NULLIF(p_payload ->> 'stripe_customer_id', '');

    IF v_user_id IS NULL OR v_stripe_customer_id IS NULL THEN
      RAISE EXCEPTION 'Missing required payload fields';
    END IF;

    UPDATE public.profiles
    SET stripe_customer_id = v_stripe_customer_id,
        updated_at = now()
    WHERE user_id = v_user_id;

    RETURN jsonb_build_object('ok', true, 'updated', FOUND);
  END IF;

  RAISE EXCEPTION 'Unsupported action: %', p_action;
END;
$function$;

REVOKE ALL ON FUNCTION public.edge_profiles(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edge_profiles(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.edge_profiles(text, jsonb) TO authenticated;
