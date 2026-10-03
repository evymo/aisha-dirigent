# P1: Knowledge Base + Global Discussion Layer

**Status:** Draft  
**Priority:** P1  
**Date:** 2026-02-11

## Goal

Build a new multilingual `Knowledge Base` that sits above the existing archive:

1. Archive stays source-of-truth for verified historical/material documents.
2. Knowledge Base adds living topics, discussion, and AI-assisted navigation.
3. Every topic is readable in multiple languages with automatic translation.
4. Members can discuss globally, while internal verified materials stay curated.

The result is a shared community intelligence layer, not just a static document list.

## Product Scope

1. Public and member-facing topic library (`/knowledge`).
2. Topic detail page with:
3. Curated lead article.
4. Linked archive documents with preview/download.
5. Community discussion thread.
6. AI summary + "key points" panel.
7. Auto-translation across supported locales.
8. Verified content badges and source provenance.
9. Shareable deep links (topic, post, comment anchor).
10. Optional StoryLoop link block for partner/member workflow.

## Architecture Fit With Current System

This proposal reuses existing patterns already in the codebase:

1. `RPC-only` data access from frontend hooks.
2. `translations` table and locale-aware RPC style used by archive.
3. Existing archive viewer components for document preview.
4. Existing audit journal flow for sensitive operations.
5. Existing route and lazy-loading patterns in `src/router.tsx`.

No direct sensitive data table access is needed for this feature.

## Data Model (New Tables)

All table access from client remains through RPC.

1. `knowledge_topics`
2. `id uuid pk`
3. `slug text unique`
4. `title_key text not null`
5. `summary_key text null`
6. `source_locale text not null default 'en'`
7. `visibility text check in ('public','members','internal')`
8. `verification_status text check in ('draft','reviewed','verified')`
9. `is_locked boolean default false`
10. `created_by uuid`
11. `created_at timestamptz`
12. `updated_at timestamptz`

1. `knowledge_topic_versions`
2. `id uuid pk`
3. `topic_id uuid fk -> knowledge_topics`
4. `version_no int`
5. `body_markdown text`
6. `change_note text`
7. `approved_by uuid null`
8. `created_at timestamptz`

1. `knowledge_topic_links`
2. `id uuid pk`
3. `topic_id uuid fk`
4. `archive_document_id uuid fk -> archive_documents null`
5. `external_url text null`
6. `link_type text check in ('archive','paper','guideline','policy','other')`
7. `is_verified boolean default false`
8. `sort_order int`

1. `knowledge_posts`
2. `id uuid pk`
3. `topic_id uuid fk`
4. `author_user_id uuid fk`
5. `body_original text`
6. `original_locale text`
7. `status text check in ('visible','hidden','flagged','deleted')`
8. `moderation_reason text null`
9. `created_at timestamptz`
10. `updated_at timestamptz`

1. `knowledge_post_translations`
2. `id uuid pk`
3. `post_id uuid fk`
4. `locale text`
5. `body_translated text`
6. `provider text`
7. `model text`
8. `quality_score numeric null`
9. `is_human_reviewed boolean default false`
10. `source_hash text`
11. `created_at timestamptz`

1. `knowledge_moderation_queue`
2. `id uuid pk`
3. `resource_type text check in ('topic','post')`
4. `resource_id uuid`
5. `risk_score numeric`
6. `risk_tags text[]`
7. `status text check in ('pending','approved','rejected','escalated')`
8. `reviewer_user_id uuid null`
9. `created_at timestamptz`

## Security, Compliance, and Governance

1. Keep all topic/discussion content non-sensitive-data by policy.
2. Add AI + rules moderation before publish for user posts.
3. Reject or quarantine posts containing probable sensitive data patterns.
4. Log moderation and publish actions in audit journal.
5. No raw sensitive data in logs (`safeError` only).
6. `SECURITY DEFINER` + `SET search_path` for anon-readable public RPCs.
7. Internal/verified editing paths allowed only for admin/staff roles.

## RPC Layer (Proposed)

Public/member read RPCs:

1. `get_knowledge_topics_localized(p_locale, p_visibility, p_search, p_limit, p_offset)`
2. `get_knowledge_topic_detail_localized(p_slug, p_locale)`
3. `get_knowledge_topic_posts_localized(p_topic_id, p_locale, p_limit, p_cursor)`
4. `get_knowledge_topic_filters()`

Write/moderation RPCs:

1. `create_knowledge_post_audited(p_topic_id, p_body, p_original_locale)`
2. `translate_knowledge_post_audited(p_post_id, p_target_locale)` (edge-safe wrapper pattern)
3. `flag_knowledge_post_audited(p_post_id, p_reason)`
4. `moderate_knowledge_post_admin(p_post_id, p_action, p_note)`
5. `create_knowledge_topic_admin(...)`
6. `update_knowledge_topic_admin(...)`
7. `link_knowledge_topic_archive_document_admin(...)`

Implementation notes:

1. Explicit columns only, never `select *`.
2. Return locale-resolved strings same as archive localized RPC pattern.
3. Use stable cursor pagination for discussion feed.

## Translation Strategy

1. Topic metadata and curated copy:
2. Keep canonical keys in `translations` namespace `knowledge`.
3. Use `get_translation_value_with_fallback` in localized RPCs.

1. User discussion posts:
2. Store original text once (`knowledge_posts.body_original`).
3. Generate per-locale translations asynchronously into `knowledge_post_translations`.
4. Invalidate translations when source changes using `source_hash`.
5. Show label: original / auto-translated / reviewed translation.

## UI/UX Flows

Routes:

1. `/knowledge` topic index.
2. `/knowledge/:slug` topic detail + discussion.

Topic detail sections:

1. Hero with verification and language status.
2. "What you are reading" context block (reuse archive editorial style).
3. Linked archive documents using existing `DocumentViewer`.
4. Discussion timeline with translate toggle.
5. AI summary panel with citations to linked sources.
6. Share controls (copy link, open in StoryLoop context).

StoryLoop integration:

1. Add optional `knowledge_topic` entry block type.
2. Allow partner/member to attach topic reference to story entries.
3. Reuse notification system for replies/mentions.

## Rollout Plan

Phase 1 (MVP, 2 sprints):

1. DB tables + RLS + read/write RPC base.
2. `/knowledge` + `/knowledge/:slug` pages.
3. Topic linking to archive docs.
4. Basic discussion posting.
5. Auto-translation for EN/CS only.
6. Admin moderation queue page.

Phase 2:

1. Add all supported locales.
2. Add AI summaries and "related topics" ranking.
3. Add StoryLoop topic block integration.
4. Add verified source workflows (admin/staff approval).

Phase 3:

1. Reputation and expert badges.
2. Debate mode with pro/con evidence cards.
3. Structured operational recommendation template cards.

## Acceptance Criteria (MVP)

1. Member can read and write in own language; others see auto-translation.
2. Topic page can attach archive document and render preview.
3. Public topics readable by anon through safe public RPC.
4. Moderators can flag/hide unsafe posts.
5. No direct `.from()` usage from frontend for this feature.
6. No hardcoded UI strings; all via i18n keys.
7. Relevant tests pass (hooks/pages/RPC contracts) and build passes.

## Risks and Mitigations

1. Risk: translation quality can distort medical nuance.
2. Mitigation: show original text side-by-side + verification labels.

1. Risk: community posts may include sensitive data accidentally.
2. Mitigation: pre-publish sensitive data detection + moderation hold.

1. Risk: high read load on topic discussions.
2. Mitigation: cursor pagination + indexed topic/time columns + React Query caching.

## Suggested First Build Slice

Implement first:

1. `knowledge_topics`, `knowledge_posts`, `knowledge_post_translations` tables.
2. 4 RPCs: list topics, topic detail, list posts, create post.
3. Frontend pages `/knowledge` and `/knowledge/:slug`.
4. Auto-translation worker for EN <-> CS.
5. Minimal admin moderation action (hide/restore post).

This gives a working global debate layer quickly, while keeping compliance and existing architecture standards.
