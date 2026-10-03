-- Table: public_chat_channels
-- Channel-centric architecture — channel is the sole config source (no agent_configurations FK)
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS public.public_chat_channels (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL UNIQUE,
  display_name     text NOT NULL,
  channel_type     public_chat_channel_type NOT NULL DEFAULT 'web_widget',
  status           public_chat_channel_status NOT NULL DEFAULT 'draft',

  -- Context profile — which context layers are used
  context_profile   text NOT NULL DEFAULT 'public_chat',

  -- LLM configuration — channel is the sole source
  system_prompt     text NOT NULL DEFAULT '',
  model             text NOT NULL DEFAULT 'gpt-4o-mini',
  temperature       numeric NOT NULL DEFAULT 0.7,
  max_tokens        int4 NOT NULL DEFAULT 2048,

  -- Personality — whether to include Hippocampus personality context
  personality_enabled boolean NOT NULL DEFAULT true,

  -- n8n webhook — the URL n8n exposes for this channel
  webhook_url       text,
  webhook_secret    text,

  -- Guardrails configuration
  guardrails        jsonb NOT NULL DEFAULT '{
    "max_message_length": 2000,
    "rate_limit_per_minute": 10,
    "rate_limit_per_hour": 100,
    "blocked_topics": [],
    "require_greeting": true,
    "allow_external_links": false,
    "escalation_keywords": ["speak to human", "complaint", "urgent"],
    "pii_redaction": true,
    "language_detection": true,
    "allowed_languages": ["cs", "en", "de"]
  }'::jsonb,

  -- Routing rules — when to delegate to sub-agents
  routing_rules     jsonb NOT NULL DEFAULT '{
    "default_agent": null,
    "rules": [
      {"trigger": "knowledge_query", "delegate_to": "WF_KNOWLEDGE_AGENT", "description": "Delegate knowledge lookups"},
      {"trigger": "escalation_signal", "delegate_to": "WF_DIRIGENT_AGENT", "description": "Escalate to main orchestrator"},
      {"trigger": "product_inquiry", "delegate_to": null, "description": "Handle inline with FAQ context"}
    ]
  }'::jsonb,

  -- Allowed MCP tools — whitelist of tools this channel can use
  allowed_tools     jsonb NOT NULL DEFAULT '[
    "search_knowledge",
    "search_knowledge_v2",
    "get_knowledge_item",
    "search_ragnarok"
  ]'::jsonb,

  -- Appearance / branding
  widget_config     jsonb NOT NULL DEFAULT '{
    "theme": "light",
    "accent_color": "#6366f1",
    "avatar_url": null,
    "welcome_message_key": "publicChat.welcome",
    "placeholder_key": "publicChat.placeholder",
    "position": "bottom-right"
  }'::jsonb,

  -- Lead capture settings
  lead_capture      jsonb NOT NULL DEFAULT '{
    "enabled": false,
    "collect_email": true,
    "collect_name": true,
    "collect_phone": false,
    "trigger_after_messages": 3,
    "notify_workflow": "WF_DIRIGENT_AGENT"
  }'::jsonb,

  -- Analytics
  total_sessions    int4 NOT NULL DEFAULT 0,
  total_messages    int4 NOT NULL DEFAULT 0,

  -- Audit
  created_by        uuid REFERENCES aisha_auth.users(id),
  updated_by        uuid REFERENCES aisha_auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- Provider-specific LLM config: reasoning effort, store flag, response_format etc.
  model_settings    jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- RAG pipeline config: knowledge_search (pgvector), ragnarok (ES hybrid), embedding_model
  vector_store_config jsonb NOT NULL DEFAULT '{
    "knowledge_search": {
      "enabled": true,
      "item_types": [],
      "category": null,
      "context_tags": [],
      "similarity_threshold": 0.3,
      "limit": 20
    },
    "ragnarok": {
      "enabled": true,
      "project_id": "evymo",
      "kb_ids": [],
      "lang": "cs-CZ",
      "return_matched_chunks": true
    },
    "embedding_model": "text-embedding-3-small"
  }'::jsonb
);

ALTER TABLE public.public_chat_channels ENABLE ROW LEVEL SECURITY;
