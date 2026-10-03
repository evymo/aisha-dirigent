-- Source of Truth: project_presets
-- Purpose: Template presets for bootstrapping new project stories with
--          pre-configured rules, KB tags, tech stack and build config.
-- Used by: create_story_from_preset() RPC
-- Migration: 20260329100000_knowledge_project_scoping_and_presets.sql

CREATE TABLE IF NOT EXISTS public.project_presets (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  -- Rule selection
  rule_slugs text[] NOT NULL DEFAULT '{}',
  -- Context profile for the story
  context_profile_slug text NOT NULL DEFAULT 'repo_plus_rules',
  -- Knowledge scoping tags (project:<slug>, domain tags)
  knowledge_tags text[] NOT NULL DEFAULT '{}',
  -- Project metadata defaults
  tech_stack text[] NOT NULL DEFAULT '{}',
  domain text[] NOT NULL DEFAULT '{}',
  risk_profile text NOT NULL DEFAULT 'medium',
  -- Default build_config for story_contexts
  default_build_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Metadata
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_presets ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.project_presets TO authenticated;
GRANT ALL ON public.project_presets TO service_role;
