-- ============================================================================
-- Core seed: ai_provider_registry — AISHA dispatch provider catalog
-- ============================================================================
-- Canonical SoT for the provider catalog AISHA's resolver
-- (aisha_resolve_clow_backend) dispatches to. Consolidated from the former
-- archived migrations (20260515120200_provider_catalog_and_mcp_lifecycle,
-- 20260518040000_provider_catalog_extensions, 20260521040000_bge_reranker_provider)
-- into a single idempotent core seed so the catalog lives in canonical SoT
-- (not archive/) and lands on every cold-start.
--
-- Schema (table + backend_kind CHECK) lives in
-- aisha/db/sql/tables/ai_provider_registry.sql. This file is DATA only.
--
-- Idempotent: ON CONFLICT (slug) DO UPDATE refreshes catalog metadata but
-- NEVER touches is_enabled — the operator's opt-in/opt-out choice is preserved
-- across re-seeds. Default-disabled providers are disabled by explicit UPDATEs
-- below (guarded so they don't clobber an operator who later enabled them).
-- ============================================================================

-- ── Dispatchable LLM providers (base + extensions) ──────────────────────────
INSERT INTO public.ai_provider_registry
  (slug, display_name, backend_kind, endpoint_url, auth_env_var,
   supports_tool_use, supports_vision, supports_batch, cost_class, notes)
VALUES
  ('anthropic', 'Anthropic (direct)', 'direct_cloud', 'https://api.anthropic.com', 'ANTHROPIC_API_KEY',
   true, true, true, 'premium',
   'Direct Anthropic API. AISHA uses for sync calls + Message Batches deferred (50% off).'),
  ('openai', 'OpenAI (direct)', 'direct_cloud', 'https://api.openai.com', 'OPENAI_API_KEY',
   true, true, true, 'standard',
   'Direct OpenAI API. Sync calls + Batch API deferred (50% off).'),
  ('google-genai', 'Google Generative AI', 'direct_cloud', 'https://generativelanguage.googleapis.com', 'GOOGLE_AI_API_KEY',
   true, true, false, 'budget',
   'Gemini family direct. No batch endpoint yet — use sync only.'),
  ('huggingface', 'Hugging Face Inference', 'direct_cloud', 'https://api-inference.huggingface.co', 'HUGGINGFACE_TOKEN',
   false, false, false, 'budget',
   'HF Inference API for open-source models. Disabled by default; enable when models are added.'),
  -- llm-gateway: first-class self-hosted gateway. INTERNAL ONLY — never exposed
  -- publicly. The seed default is the in-cluster Docker alias; cold-start
  -- reconciles endpoint_url to the DERIVED AISHA_LLM_GATEWAY_URL (internal/mesh
  -- domain) so it is never the public API-gateway host (gateway.aisha.guru =
  -- API gateway, a DIFFERENT service — pointing here at it is the bug we fixed).
  -- No infra domain is hardcoded in this seed (feedback_no_infra_in_repo).
  ('llm-gateway', 'AISHA LLM Gateway', 'llm_gateway', 'http://llm-gateway:4000/v1', 'AISHA_LLM_GATEWAY_KEY',
   true, true, true, 'standard',
   'Self-hosted theopenco/llmgateway, internal only (NOT exposed externally). Default endpoint is the in-cluster alias http://llm-gateway:4000/v1; cold-start reconciles it to the derived AISHA_LLM_GATEWAY_URL. Uses our direct ANTHROPIC/OPENAI/GOOGLE keys; resolver may pick it for sync when cost/capability fit. For pooled access to xAI/DeepSeek/Mistral/Cohere/Together/OpenRouter via a single key, see llmgateway-io. For OpenRouter direct, see the openrouter provider.'),
  ('ollama-local', 'Ollama (local)', 'local_ollama', 'http://ollama:11434', 'OLLAMA_API_KEY',
   false, true, false, 'budget',
   'Local Ollama runtime. Cheap fallback for budget profile and exploration tasks. Disabled if not deployed.'),
  -- llmgateway.io managed meta-provider: single LLM_GW_API_KEY pools upstream
  -- (xAI/DeepSeek/Mistral/Cohere/Together/OpenRouter) at lower per-token cost.
  ('llmgateway-io', 'llmgateway.io (managed)', 'llm_gateway', 'https://api.llmgateway.io/v1', 'LLM_GW_API_KEY',
   true, true, true, 'budget',
   'Managed llmgateway.io. Pooled access to xAI/DeepSeek/Mistral/Cohere/Together/OpenRouter via single LLM_GW_API_KEY at typically lower per-token cost than direct provider APIs. OpenAI-compat interface. AISHA prefers this for non-flagship models when budget profile is selected.'),
  ('xai', 'xAI Grok (direct)', 'direct_cloud', 'https://api.x.ai/v1', 'XAI_API_KEY',
   true, false, false, 'standard',
   'Direct xAI API for Grok models. Disabled by default — set XAI_API_KEY in env and UPDATE is_enabled=true. Until then, prefer llmgateway-io which pools xAI access.'),
  ('mistral', 'Mistral AI (direct)', 'direct_cloud', 'https://api.mistral.ai/v1', 'MISTRAL_API_KEY',
   true, false, false, 'budget',
   'Direct Mistral API. Disabled by default. Until enabled, prefer llmgateway-io which pools Mistral access.'),
  ('deepseek', 'DeepSeek (direct)', 'direct_cloud', 'https://api.deepseek.com', 'DEEPSEEK_API_KEY',
   true, false, false, 'budget',
   'Direct DeepSeek API (R1, V3). Disabled by default. Until enabled, prefer llmgateway-io which pools DeepSeek access.'),
  -- openrouter: direct first-class provider (OpenAI-compatible aggregator) so
  -- AISHA can pick it like any other provider — not only pooled via llmgateway-io.
  ('openrouter', 'OpenRouter (direct)', 'direct_cloud', 'https://openrouter.ai/api/v1', 'OPENROUTER_API_KEY',
   true, false, false, 'budget',
   'Direct OpenRouter API — OpenAI-compatible aggregator for many open-source + commercial models (Llama, Qwen, DeepSeek, Mistral, GLM, etc.). AISHA selects it directly like any other provider when cost/capability fit. Disabled by default — set OPENROUTER_API_KEY + UPDATE is_enabled=true. Also reachable pooled via llmgateway-io.')
ON CONFLICT (slug) DO UPDATE
SET display_name      = EXCLUDED.display_name,
    backend_kind      = EXCLUDED.backend_kind,
    endpoint_url      = EXCLUDED.endpoint_url,
    auth_env_var      = EXCLUDED.auth_env_var,
    supports_tool_use = EXCLUDED.supports_tool_use,
    supports_vision   = EXCLUDED.supports_vision,
    supports_batch    = EXCLUDED.supports_batch,
    cost_class        = EXCLUDED.cost_class,
    notes             = EXCLUDED.notes,
    updated_at        = now();

-- ── vllm-local: lokální OpenAI-kompat serving (svc-model) — stav a adresa ODVOZENÉ ──
-- ⛔ NAMĚŘENO 2026-09-13: řádek stál ve společném INSERTu výš s placeholderem
-- `http://vllm:8000` (alias, který v žádné instanci neexistuje) a s ON CONFLICT, který
-- endpoint_url přepisoval při KAŽDÉM seedu; blok „Default-disabled" níž ho pak zase
-- vypínal (jeho strážní `[opt-in:` v notes smazal týž ON CONFLICT). Nic ho nezapínalo.
--
-- Od teď: is_enabled, endpoint_url a health_url VLASTNÍ migrate —
-- scripts/deploy/reconcile-local-model-provider.sql je odvozuje z VLLM_GENERATION_URL
-- (resolver topologie ji vydá jen pro provisionovaný svc-model). Seed řádek jen ZALOŽÍ
-- (vypnutý, bez adresy) a při dalších bězích obnoví popisná metadata — nikdy stav, který
-- odvozuje nasazení. Jinak by každý deploy adresu shodil na placeholder a reconcile by
-- ji pokaždé „měnil" (audit + modely nedostupné do další discovery).
INSERT INTO public.ai_provider_registry
  (slug, display_name, backend_kind, endpoint_url, auth_env_var,
   supports_tool_use, supports_vision, supports_batch, cost_class, is_enabled, notes)
VALUES
  ('vllm-local', 'Lokální model (svc-model, OpenAI-kompat)', 'local_vllm', NULL, NULL,
   false, true, false, 'budget', false,
   'Lokální OpenAI-kompat serving instance (svc-model, llama.cpp). Stav a adresu ODVOZUJE migrate z VLLM_GENERATION_URL (scripts/deploy/reconcile-local-model-provider.sql); bez provisionovaného svc-model zůstává vypnutý. Které modely obsluhuje, určuje discovery z živého /v1/models.')
ON CONFLICT (slug) DO UPDATE
SET display_name      = EXCLUDED.display_name,
    backend_kind      = EXCLUDED.backend_kind,
    auth_env_var      = EXCLUDED.auth_env_var,
    supports_tool_use = EXCLUDED.supports_tool_use,
    supports_vision   = EXCLUDED.supports_vision,
    supports_batch    = EXCLUDED.supports_batch,
    cost_class        = EXCLUDED.cost_class,
    notes             = EXCLUDED.notes,
    updated_at        = now();

-- ── Stage-2 rerank scorers (different column shape; never chat dispatch) ─────
INSERT INTO public.ai_provider_registry
  (slug, display_name, backend_kind, endpoint_url, health_url,
   auth_kind, auth_env_var,
   supports_chat, supports_tool_use, supports_vision, supports_batch, supports_streaming,
   is_enabled, cost_class, notes, metadata)
VALUES
  ('bge_reranker_local', 'bge-reranker-v2-m3 (on-prem vLLM)', 'local_vllm',
   'http://vllm-reranker:8000', 'http://vllm-reranker:8000/v1/models',
   'none', NULL,
   false, false, false, false, false,
   true, 'budget',
   'Stage-2 rerank cross-encoder, multilingual (100+ langs), 568M params, ~1.2 GB VRAM. Exposed via vLLM /score endpoint (--task=score), NOT /v1/chat/completions.',
   jsonb_build_object('model', 'BAAI/bge-reranker-v2-m3', 'task', 'score', 'max_model_len', 8192,
                      'gpu_memory_utilization', 0.15, 'rag_purposes', jsonb_build_array('rag.rerank'))),
  ('cohere_rerank', 'Cohere Rerank v3 (paid SaaS)', 'direct_cloud',
   'https://api.cohere.com/v1/rerank', NULL,
   'bearer', 'COHERE_API_KEY',
   false, false, false, true, false,
   false, 'premium',
   'Premium-only Stage-2 rerank fallback. Enable per-customer via update_provider_admin RPC.',
   jsonb_build_object('model', 'rerank-multilingual-v3.0', 'rag_purposes', jsonb_build_array('rag.rerank')))
ON CONFLICT (slug) DO NOTHING;

-- ── Default-disabled providers (opt-in: add key to env + UPDATE is_enabled) ──
-- Local/optional providers without keys in a fresh deployment.
-- vllm-local tu NENÍ: jeho is_enabled vlastní migrate reconcile (viz blok vllm-local výš).
UPDATE public.ai_provider_registry
SET is_enabled = false,
    notes = COALESCE(notes, '') || ' [opt-in: deploy + set env to enable]'
WHERE slug IN ('huggingface', 'ollama-local')
  AND is_enabled = true
  AND notes NOT LIKE '%[opt-in:%';

-- Direct placeholders pooled via llmgateway-io until operator adds the key.
UPDATE public.ai_provider_registry
SET is_enabled = false,
    notes = COALESCE(notes, '') || ' [opt-in: add ' || COALESCE(auth_env_var, 'key') || ' to env + UPDATE is_enabled=true to enable]'
WHERE slug IN ('xai', 'mistral', 'deepseek', 'openrouter')
  AND is_enabled = true
  AND notes NOT LIKE '%[opt-in:%';

-- ── Audit: record that the provider catalog was seeded ──────────────────────
INSERT INTO public.audit_journal (user_id, action, metadata)
VALUES (
  NULL,
  'provider_catalog_seeded',
  jsonb_build_object(
    'source', 'aisha/db/seed/core/19_ai_provider_catalog.sql',
    'dispatch_slugs', ARRAY['anthropic', 'openai', 'google-genai', 'huggingface', 'llm-gateway',
                            'ollama-local', 'vllm-local', 'llmgateway-io', 'xai', 'mistral', 'deepseek', 'openrouter'],
    'rerank_slugs', ARRAY['bge_reranker_local', 'cohere_rerank'],
    'enabled_by_default', ARRAY['anthropic', 'openai', 'google-genai', 'llm-gateway', 'llmgateway-io', 'bge_reranker_local'],
    'disabled_by_default', ARRAY['huggingface', 'ollama-local', 'xai', 'mistral', 'deepseek', 'openrouter', 'cohere_rerank'],
    'derived_from_topology', ARRAY['vllm-local']
  )
);
