-- Function: public.get_active_channel_config
-- Arguments: p_channel_slug text
-- Description: Returns full channel config for n8n / edge functions. Channel is the sole config source.
-- Security: SECURITY DEFINER
-- Search path: public (set per-function below)
-- Source: aisha/db/migrations/20260411180000_drop_agent_configurations.sql

CREATE OR REPLACE FUNCTION public.get_active_channel_config(p_channel_slug text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_channel record;
  v_result  jsonb;
BEGIN
  -- ⛔ NÁROK, NE JEN DOSTUPNOST (naměřeno 2026-09-12). Funkce vydává
  -- `system_prompt`, `guardrails`, `routing_rules`, `allowed_tools`
  -- a `vector_store_config` — tedy přesně to, co útočník potřebuje, aby
  -- guardraily obešel. Volat ji směl i ANONYM, stačil slug kanálu.
  --
  -- Hlavička sama říká, čí je to pohled: „for n8n / edge functions". Změřeno,
  -- kdo ji v repu volá: svc-ai-chat (chat, public-chat, story-consult),
  -- svc-mcp-knowledge a WF_PUBLIC_CHATBOT — všichni přes SERVICE klíč
  -- (`rpcService`, resp. AISHA_POSTGREST_SERVICE_KEY). Z prohlížeče ji nevolá
  -- nikdo, takže zúžení na službu a správu žádného konzumenta nebere.
  IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Service role or admin access required';
  END IF;

  SELECT
    pcc.id,
    pcc.slug,
    pcc.display_name,
    pcc.channel_type,
    pcc.context_profile,
    pcc.personality_enabled,
    pcc.model,
    pcc.temperature,
    pcc.max_tokens,
    pcc.system_prompt,
    pcc.model_settings,
    pcc.vector_store_config,
    pcc.guardrails,
    pcc.routing_rules,
    pcc.allowed_tools,
    pcc.widget_config,
    pcc.lead_capture
  INTO v_channel
  FROM public.public_chat_channels pcc
  WHERE pcc.slug = p_channel_slug AND pcc.status = 'active';

  IF v_channel IS NULL THEN
    RETURN jsonb_build_object('error', 'Channel not found or inactive');
  END IF;

  v_result := jsonb_build_object(
    'channel_id',           v_channel.id,
    'slug',                 v_channel.slug,
    'display_name',         v_channel.display_name,
    'channel_type',         v_channel.channel_type,
    'context_profile',      v_channel.context_profile,
    'personality_enabled',  v_channel.personality_enabled,
    -- LLM config — channel is the sole source
    'model',                v_channel.model,
    'temperature',          v_channel.temperature,
    'max_tokens',           v_channel.max_tokens,
    'system_prompt',        v_channel.system_prompt,
    'model_settings',       v_channel.model_settings,
    -- RAG pipeline config
    'vector_store_config',  v_channel.vector_store_config,
    -- Channel-specific config
    'guardrails',           v_channel.guardrails,
    'routing_rules',        v_channel.routing_rules,
    'allowed_tools',        v_channel.allowed_tools,
    'widget_config',        v_channel.widget_config,
    'lead_capture',         v_channel.lead_capture
  );

  RETURN v_result;
END;
$$;

-- `anon` tu ZÁMĚRNĚ není: bez účtu se k systémovému promptu nikdo nedostane.
-- `authenticated` zůstává, protože správce kanály nastavuje — nárok mu ale
-- dává STRÁŽ V TĚLE, ne grant (týž tvar jako get_test_questions_admin_localized).
REVOKE ALL ON FUNCTION public.get_active_channel_config(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_channel_config(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_channel_config(text) TO service_role;
