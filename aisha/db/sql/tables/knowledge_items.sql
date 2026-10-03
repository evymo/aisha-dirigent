-- Table: knowledge_items

CREATE TABLE IF NOT EXISTS public.knowledge_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  item_type knowledge_item_type NOT NULL,
  source_type text DEFAULT 'manual'::text NOT NULL,
  source_id uuid,
  source_slug text,
  title text NOT NULL,
  summary text,
  body_markdown text NOT NULL,
  ai_instructions text,
  ai_context_tags text[] DEFAULT '{}'::text[],
  category text,
  expertise_area_id uuid,
  status text DEFAULT 'active'::text NOT NULL,
  visibility text DEFAULT 'public'::text NOT NULL,
  version integer DEFAULT 1 NOT NULL,
  author_id uuid,
  author_display_name text,
  usage_count integer DEFAULT 0 NOT NULL,
  rating_avg numeric DEFAULT 0 NOT NULL,
  is_verified boolean DEFAULT false NOT NULL,
  published_at timestamp with time zone,
  story_id uuid REFERENCES public.partner_stories(id) ON DELETE CASCADE,
  -- Ingestion safety / quarantine columns (migration 20260518240000_ingestion_safety.sql).
  -- Prompt-injection detector + LLM judge flag items; quarantined items
  -- are excluded from retrieval until a human review reinstates them.
  quarantine_status text DEFAULT 'clear'::text NOT NULL
    CHECK (quarantine_status IN ('clear', 'flagged', 'quarantined', 'reviewed', 'reinstated')),
  quarantine_reason text,
  quarantine_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  safety_scanned_at timestamp with time zone,
  safety_score numeric(4, 3) CHECK (safety_score IS NULL OR safety_score BETWEEN 0 AND 1),
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE public.knowledge_items ENABLE ROW LEVEL SECURITY;

-- Columns added by later migrations (back-port reconciliation):
ALTER TABLE public.knowledge_items ADD COLUMN IF NOT EXISTS has_multimodal boolean NOT NULL DEFAULT false;
ALTER TABLE public.knowledge_items ADD COLUMN IF NOT EXISTS multimodal_provider text;
-- RAG locale axis (Brick3). Behavior-neutral today: every row defaults to the
-- 'global' sentinel (FK → supported_languages.code, NO ON DELETE CASCADE). No
-- retrieval WHERE/score uses locale yet — later bricks add cross-lingual boost.
-- source_hash is the content-dedup key for re-ingestion idempotency (nullable).
ALTER TABLE public.knowledge_items ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'global';
ALTER TABLE public.knowledge_items ADD COLUMN IF NOT EXISTS source_hash text;
-- Brick5 cross-lingual: source_concept_id groups locale variants of one source node
-- (= COALESCE(source_id, id), set by trg_knowledge_source_concept_id). Retrieval dedups
-- by it (one winning variant per concept) + applies a p_locale preference-boost.
-- Nullable; set by the trigger on write, backfilled in heals.sql for existing rows.
ALTER TABLE public.knowledge_items ADD COLUMN IF NOT EXISTS source_concept_id uuid;
-- Brick6 tier-ACL: minimum_tier gates retrieval by the requesting user's audience tier
-- (anonymous < registered < active < qualified < partner < admin). NULL = ungated (everyone).
-- Enforced as a HARD WHERE filter in mcp_search_knowledge_v2/v3 via
-- audience_user_meets_tier_requirement(minimum_tier, audience_user) — an under-tier user
-- never retrieves the row (unlike locale, which is a soft rerank boost).
ALTER TABLE public.knowledge_items ADD COLUMN IF NOT EXISTS minimum_tier text;
