-- Function: public.upsert_public_chat_channel
-- Arguments: p_id uuid, p_slug text, p_display_name text, p_channel_type text, p_status text, p_context_profile text, p_model text, p_temperature numeric, p_max_tokens int4, p_system_prompt text, p_model_settings jsonb, p_vector_store_config jsonb, p_personality_enabled boolean, p_webhook_url text, p_webhook_secret text, p_guardrails jsonb, p_routing_rules jsonb, p_allowed_tools jsonb, p_widget_config jsonb, p_lead_capture jsonb, p_change_summary text
-- Description: Admin CRUD with history for public chat channels (channel-centric, no agent FK)
-- Security: SECURITY DEFINER
-- Search path: public (set per-function below)
-- Source: supabase/migrations/20260411180000_drop_agent_configurations.sql

CREATE OR REPLACE FUNCTION public.upsert_public_chat_channel(
  p_id                     uuid DEFAULT NULL,
  p_slug                   text DEFAULT NULL,
  p_display_name           text DEFAULT NULL,
  p_channel_type           text DEFAULT 'web_widget',
  p_status                 text DEFAULT 'draft',
  p_context_profile        text DEFAULT 'public_chat',
  p_model                  text DEFAULT 'gpt-4o-mini',
  p_temperature            numeric DEFAULT 0.7,
  p_max_tokens             int4 DEFAULT 2048,
  p_system_prompt          text DEFAULT '',
  p_model_settings         jsonb DEFAULT '{}'::jsonb,
  p_vector_store_config    jsonb DEFAULT NULL,
  p_personality_enabled    boolean DEFAULT true,
  p_webhook_url            text DEFAULT NULL,
  p_webhook_secret         text DEFAULT NULL,
  p_guardrails             jsonb DEFAULT NULL,
  p_routing_rules          jsonb DEFAULT NULL,
  p_allowed_tools          jsonb DEFAULT NULL,
  p_widget_config          jsonb DEFAULT NULL,
  p_lead_capture           jsonb DEFAULT NULL,
  p_change_summary         text DEFAULT 'Configuration updated'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_channel_id uuid;
  v_version int4;
BEGIN
  IF p_id IS NOT NULL THEN
    -- UPDATE existing
    UPDATE public.public_chat_channels SET
      slug = COALESCE(p_slug, slug),
      display_name = COALESCE(p_display_name, display_name),
      channel_type = COALESCE(p_channel_type::public_chat_channel_type, channel_type),
      status = COALESCE(p_status::public_chat_channel_status, status),
      context_profile = COALESCE(p_context_profile, context_profile),
      model = COALESCE(p_model, model),
      temperature = COALESCE(p_temperature, temperature),
      max_tokens = COALESCE(p_max_tokens, max_tokens),
      system_prompt = COALESCE(p_system_prompt, system_prompt),
      model_settings = COALESCE(p_model_settings, model_settings),
      vector_store_config = COALESCE(p_vector_store_config, vector_store_config),
      personality_enabled = COALESCE(p_personality_enabled, personality_enabled),
      webhook_url = COALESCE(p_webhook_url, webhook_url),
      webhook_secret = COALESCE(p_webhook_secret, webhook_secret),
      guardrails = COALESCE(p_guardrails, guardrails),
      routing_rules = COALESCE(p_routing_rules, routing_rules),
      allowed_tools = COALESCE(p_allowed_tools, allowed_tools),
      widget_config = COALESCE(p_widget_config, widget_config),
      lead_capture = COALESCE(p_lead_capture, lead_capture),
      updated_by = v_user_id,
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_channel_id;

    -- Record history
    SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM public.public_chat_channel_history WHERE channel_id = p_id;

    INSERT INTO public.public_chat_channel_history (channel_id, version, configuration_snapshot, change_summary, changed_by)
    SELECT p_id, v_version, row_to_json(c)::jsonb, p_change_summary, v_user_id
    FROM public.public_chat_channels c WHERE c.id = p_id;
  ELSE
    -- INSERT new
    INSERT INTO public.public_chat_channels (
      slug, display_name, channel_type, status,
      context_profile, model, temperature, max_tokens, system_prompt,
      model_settings, vector_store_config,
      personality_enabled, webhook_url, webhook_secret,
      guardrails, routing_rules, allowed_tools,
      widget_config, lead_capture,
      created_by, updated_by
    ) VALUES (
      p_slug, p_display_name,
      p_channel_type::public_chat_channel_type,
      p_status::public_chat_channel_status,
      p_context_profile, p_model, p_temperature, p_max_tokens, p_system_prompt,
      COALESCE(p_model_settings, '{}'::jsonb),
      COALESCE(p_vector_store_config, '{}'::jsonb),
      p_personality_enabled, p_webhook_url, p_webhook_secret,
      COALESCE(p_guardrails, '{}'::jsonb),
      COALESCE(p_routing_rules, '{}'::jsonb),
      COALESCE(p_allowed_tools, '[]'::jsonb),
      COALESCE(p_widget_config, '{}'::jsonb),
      COALESCE(p_lead_capture, '{}'::jsonb),
      v_user_id, v_user_id
    )
    RETURNING id INTO v_channel_id;

    -- Record initial version
    INSERT INTO public.public_chat_channel_history (channel_id, version, configuration_snapshot, change_summary, changed_by)
    SELECT v_channel_id, 1, row_to_json(c)::jsonb, 'Channel created', v_user_id
    FROM public.public_chat_channels c WHERE c.id = v_channel_id;
  END IF;

  RETURN v_channel_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_public_chat_channel(
  uuid, text, text, text, text, text, text, numeric, int4, text,
  jsonb, jsonb, boolean, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_public_chat_channel(
  uuid, text, text, text, text, text, text, numeric, int4, text,
  jsonb, jsonb, boolean, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, text
) TO authenticated;
