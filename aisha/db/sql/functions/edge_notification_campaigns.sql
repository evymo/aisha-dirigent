-- Function: public.edge_notification_campaigns
-- Purpose: Edge-safe notification campaign scheduler operations.

CREATE OR REPLACE FUNCTION public.edge_notification_campaigns(
  p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_sekce text;
  v_publikum jsonb;
BEGIN
  -- ⛔ SECURITY DEFINER pomocník MUSÍ autorizovat sám sebe. Do 2026-09-21 tahle
  -- funkce stráž NEMĚLA a přitom má `GRANT EXECUTE … TO authenticated`, takže
  -- KAŽDÝ přihlášený si mohl akcí `get_all_profile_user_ids` vytáhnout seznam
  -- všech uživatelů instance. Bylo to vedené jako známá výjimka v
  -- `security-known-issues.ts`; výjimka se ruší, protože skutečný volající je
  -- jediný — worker svc-push pod service_role (ověřeno: plocha ani mobil ji
  -- nevolají, jen generované typy ji zmiňují).
  IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Unauthorized' USING errcode = '42501';
  END IF;

  IF p_action = 'claim_schedule' THEN
    UPDATE public.notification_campaign_schedules
    SET
      last_run_at = COALESCE(NULLIF(p_payload ->> 'now', '')::timestamptz, now()),
      status = 'running',
      updated_at = now()
    WHERE id = NULLIF(p_payload ->> 'schedule_id', '')::uuid
      AND status = 'scheduled'
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('claimed', v_id IS NOT NULL);
  END IF;

  IF p_action = 'get_active_study_user_ids' THEN
    RETURN jsonb_build_object(
      'rows',
      COALESCE(
        (
          SELECT jsonb_agg(jsonb_build_object('user_id', s.user_id))
          FROM public.study_registrations s
          WHERE s.study_id = NULLIF(p_payload ->> 'study_id', '')::uuid
            AND s.status = 'active'
        ),
        '[]'::jsonb
      )
    );
  END IF;

  IF p_action = 'get_all_profile_user_ids' THEN
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

  -- ⭐ Publikum podle SEKCE povrchu: kdo sekci SMÍ VIDĚT, ten smí dostat její
  -- oznámení. Oprávnění se tím NEODVOZUJE z role, ale z TÉŽE deklarace, podle
  -- které se sekce zobrazuje — jeden rozhodovač (`surface_audience_allows`),
  -- ne druhý názor vedle něj.
  --
  -- ⛔ FAIL CLOSED na neznámou nebo neaktivní sekci: překlep v `section` by jinak
  -- tiše vydal prázdné publikum a kampaň by „proběhla" bez jediného příjemce.
  -- Prázdné publikum a NEEXISTUJÍCÍ sekce musí jít rozlišit.
  IF p_action = 'get_section_audience_user_ids' THEN
    v_sekce := NULLIF(p_payload ->> 'section', '');
    IF v_sekce IS NULL THEN
      RAISE EXCEPTION 'get_section_audience_user_ids: chybí `section`' USING errcode = '22023';
    END IF;

    SELECT s.audience INTO v_publikum
    FROM public.surface_sections s
    WHERE s.surface = v_sekce AND s.state = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'neznámá nebo neaktivní sekce: %', v_sekce USING errcode = '22023';
    END IF;

    -- Predikát je ze své podstaty PER UŽIVATELE (ptá se na vazby toho člověka),
    -- takže tady je per-row správně — je to semi-join nad uživateli, ne režie
    -- v RLS predikátu. Deklarace sekce se přitom načte JEDNOU, do proměnné.
    RETURN jsonb_build_object(
      'rows',
      COALESCE(
        (
          SELECT jsonb_agg(jsonb_build_object('user_id', p.user_id))
          FROM public.profiles p
          WHERE p.user_id IS NOT NULL
            AND public.surface_audience_allows(p.user_id, v_publikum)
        ),
        '[]'::jsonb
      )
    );
  END IF;

  IF p_action = 'get_campaigns' THEN
    RETURN jsonb_build_object(
      'rows',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'audience_filter', c.audience_filter,
              'audience_type', c.audience_type,
              'base_locale', c.base_locale,
              'body_key', c.body_key,
              'data', c.data,
              'id', c.id,
              'is_active', c.is_active,
              'link', c.link,
              'name', c.name,
              'send_inapp', c.send_inapp,
              'send_push', c.send_push,
              'title_key', c.title_key
            )
          )
          FROM public.notification_campaigns c
          WHERE c.id = ANY(
            COALESCE(
              (
                SELECT array_agg(value::uuid)
                FROM jsonb_array_elements_text(COALESCE(p_payload -> 'campaign_ids', '[]'::jsonb)) AS t(value)
              ),
              ARRAY[]::uuid[]
            )
          )
            AND c.is_active = true
        ),
        '[]'::jsonb
      )
    );
  END IF;

  IF p_action = 'get_due_schedules' THEN
    RETURN jsonb_build_object(
      'rows',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'campaign_id', s.campaign_id,
              'id', s.id,
              'next_run_at', s.next_run_at,
              'repeat_interval_minutes', s.repeat_interval_minutes
            )
          )
          FROM public.notification_campaign_schedules s
          WHERE s.next_run_at <= COALESCE(NULLIF(p_payload ->> 'now', '')::timestamptz, now())
            AND s.status = 'scheduled'
        ),
        '[]'::jsonb
      )
    );
  END IF;

  IF p_action = 'insert_run' THEN
    INSERT INTO public.notification_campaign_runs (
      campaign_id,
      errors,
      inapp_sent,
      push_sent,
      recipients_count,
      run_at,
      schedule_id,
      status
    )
    VALUES (
      NULLIF(p_payload ->> 'campaign_id', '')::uuid,
      CASE WHEN p_payload ? 'errors' THEN p_payload -> 'errors' ELSE NULL END,
      COALESCE(NULLIF(p_payload ->> 'inapp_sent', '')::integer, 0),
      COALESCE(NULLIF(p_payload ->> 'push_sent', '')::integer, 0),
      COALESCE(NULLIF(p_payload ->> 'recipients_count', '')::integer, 0),
      COALESCE(NULLIF(p_payload ->> 'run_at', '')::timestamptz, now()),
      NULLIF(p_payload ->> 'schedule_id', '')::uuid,
      COALESCE(NULLIF(p_payload ->> 'status', ''), 'sent')
    )
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('id', v_id, 'ok', true);
  END IF;

  IF p_action = 'update_schedule' THEN
    UPDATE public.notification_campaign_schedules
    SET
      last_run_at = CASE WHEN p_payload ? 'last_run_at' THEN NULLIF(p_payload ->> 'last_run_at', '')::timestamptz ELSE last_run_at END,
      next_run_at = CASE WHEN p_payload ? 'next_run_at' THEN NULLIF(p_payload ->> 'next_run_at', '')::timestamptz ELSE next_run_at END,
      status = COALESCE(NULLIF(p_payload ->> 'status', ''), status),
      updated_at = now()
    WHERE id = NULLIF(p_payload ->> 'schedule_id', '')::uuid;

    RETURN jsonb_build_object('ok', true, 'updated', FOUND);
  END IF;

  RAISE EXCEPTION 'Unsupported action: %', p_action;
END;
$function$;

REVOKE ALL ON FUNCTION public.edge_notification_campaigns(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edge_notification_campaigns(text, jsonb) TO service_role;
-- ⛔ `authenticated` grant ZRUŠEN 2026-09-21. Změřeno: jediný volající je worker
-- svc-push pod service_role; administrace má vlastní `*_admin` funkce
-- (get_notification_campaigns_admin a spol.) a tuhle nevolá, plocha ani mobil
-- taky ne. Grant byl vnější dveře, které stály otevřené u funkce bez stráže.
REVOKE EXECUTE ON FUNCTION public.edge_notification_campaigns(text, jsonb) FROM authenticated;
