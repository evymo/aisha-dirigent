-- Function: public.edge_mobile_notifications
-- Purpose: Edge-safe mobile session + notification reads/writes.

CREATE OR REPLACE FUNCTION public.edge_mobile_notifications(
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
  v_user_id uuid;
BEGIN
  IF p_action = 'get_mobile_sessions' THEN
    RETURN jsonb_build_object(
      'rows',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'device_platform', m.device_platform,
              'fcm_token', m.fcm_token,
              'user_id', m.user_id
            )
          )
          FROM public.mobile_sessions m
          WHERE m.user_id = ANY(
            COALESCE(
              (
                SELECT array_agg(value::uuid)
                FROM jsonb_array_elements_text(COALESCE(p_payload -> 'user_ids', '[]'::jsonb)) AS t(value)
              ),
              ARRAY[]::uuid[]
            )
          )
          AND m.fcm_token IS NOT NULL
        ),
        '[]'::jsonb
      )
    );
  END IF;

  IF p_action = 'get_notification_preferences' THEN
    RETURN jsonb_build_object(
      'rows',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'afternoon_start', n.afternoon_start::text,
              'evening_start', n.evening_start::text,
              'morning_start', n.morning_start::text,
              'push_enabled', n.push_enabled,
              'push_reminders', n.push_reminders,
              'push_study_updates', n.push_study_updates,
              'questionnaire_reminder_period', n.questionnaire_reminder_period,
              'quiet_hours_enabled', n.quiet_hours_enabled,
              'quiet_hours_end', n.quiet_hours_end::text,
              'quiet_hours_start', n.quiet_hours_start::text,
              'user_id', n.user_id,
              'user_timezone', n.user_timezone
            )
          )
          FROM public.notification_preferences n
          WHERE n.user_id = ANY(
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

  IF p_action = 'insert_notification_log' THEN
    INSERT INTO public.notification_logs (
      created_at,
      data,
      devices_failed,
      devices_sent,
      error_message,
      notification_type,
      recipients_count,
      title
    )
    VALUES (
      COALESCE(NULLIF(p_payload ->> 'created_at', '')::timestamptz, now()),
      COALESCE(p_payload -> 'data', '{}'::jsonb),
      COALESCE(NULLIF(p_payload ->> 'devices_failed', '')::integer, 0),
      COALESCE(NULLIF(p_payload ->> 'devices_sent', '')::integer, 0),
      NULLIF(p_payload ->> 'error_message', ''),
      COALESCE(NULLIF(p_payload ->> 'notification_type', ''), 'push'),
      COALESCE(NULLIF(p_payload ->> 'recipients_count', '')::integer, 0),
      NULLIF(p_payload ->> 'title', '')
    )
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('id', v_id, 'ok', true);
  END IF;

  IF p_action = 'insert_notifications_bulk' THEN
    RETURN jsonb_build_object(
      'inserted',
      (
        WITH input_rows AS (
          SELECT
            COALESCE(NULLIF(row ->> 'link', ''), NULL) AS link,
            NULLIF(row ->> 'message', '') AS message,
            COALESCE(row -> 'metadata', '{}'::jsonb) AS metadata,
            COALESCE(NULLIF(row ->> 'title', ''), 'Notification') AS title,
            COALESCE(NULLIF(row ->> 'type', ''), 'campaign') AS type,
            NULLIF(row ->> 'user_id', '')::uuid AS user_id
          FROM jsonb_array_elements(COALESCE(p_payload -> 'rows', '[]'::jsonb)) AS t(row)
        ),
        inserted AS (
          INSERT INTO public.notifications (
            link,
            message,
            metadata,
            title,
            type,
            user_id
          )
          SELECT
            i.link,
            i.message,
            i.metadata,
            i.title,
            i.type,
            i.user_id
          FROM input_rows i
          WHERE i.user_id IS NOT NULL
          RETURNING 1
        )
        SELECT count(*) FROM inserted
      )
    );
  END IF;

  IF p_action = 'get_existing_questionnaire_reminder_keys' THEN
    RETURN jsonb_build_object(
      'rows',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'dedupe_key', n.metadata ->> 'dedupe_key'
            )
          )
          FROM public.notifications n
          WHERE n.user_id = ANY(
            COALESCE(
              (
                SELECT array_agg(value::uuid)
                FROM jsonb_array_elements_text(COALESCE(p_payload -> 'user_ids', '[]'::jsonb)) AS t(value)
              ),
              ARRAY[]::uuid[]
            )
          )
            AND n.type = 'questionnaire_request'
            AND n.metadata ? 'dedupe_key'
            AND (n.metadata ->> 'dedupe_key') = ANY(
              COALESCE(
                (
                  SELECT array_agg(value)
                  FROM jsonb_array_elements_text(COALESCE(p_payload -> 'dedupe_keys', '[]'::jsonb)) AS t(value)
                ),
                ARRAY[]::text[]
              )
            )
        ),
        '[]'::jsonb
      )
    );
  END IF;

  IF p_action = 'get_campaign_notification_deliveries_admin' THEN
    IF NOT public.is_admin_or_staff() THEN
      RAISE EXCEPTION 'Access denied';
    END IF;

    RETURN jsonb_build_object(
      'rows',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'created_at', q.created_at,
              'id', q.id,
              'is_read', q.is_read,
              'link', q.link,
              'message', q.message,
              'profile_display_name', q.profile_display_name,
              'profile_email', q.profile_email,
              'schedule_id', q.schedule_id,
              'title', q.title,
              'type', q.type,
              'user_id', q.user_id
            )
          )
          FROM (
            SELECT
              n.created_at,
              n.id,
              n.is_read,
              n.link,
              n.message,
              p.display_name AS profile_display_name,
              p.email AS profile_email,
              NULLIF(n.metadata ->> 'schedule_id', '')::uuid AS schedule_id,
              n.title,
              n.type,
              n.user_id
            FROM public.notifications n
            LEFT JOIN public.profiles p ON p.user_id = n.user_id
            WHERE (n.metadata ->> 'campaign_id') = NULLIF(p_payload ->> 'campaign_id', '')
            ORDER BY n.created_at DESC
            LIMIT GREATEST(COALESCE(NULLIF(p_payload ->> 'limit', '')::integer, 200), 1)
          ) AS q
        ),
        '[]'::jsonb
      )
    );
  END IF;

  IF p_action = 'null_mobile_session_token' THEN
    v_user_id := NULLIF(p_payload ->> 'user_id', '')::uuid;

    UPDATE public.mobile_sessions
    SET
      fcm_token = NULL,
      updated_at = now()
    WHERE
      (
        v_user_id IS NULL
        OR user_id = v_user_id
      )
      AND (
        NOT (p_payload ? 'fcm_token')
        OR fcm_token = NULLIF(p_payload ->> 'fcm_token', '')
      );

    RETURN jsonb_build_object('ok', true, 'updated', FOUND);
  END IF;

  RAISE EXCEPTION 'Unsupported action: %', p_action;
END;
$function$;

REVOKE ALL ON FUNCTION public.edge_mobile_notifications(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edge_mobile_notifications(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.edge_mobile_notifications(text, jsonb) TO authenticated;
