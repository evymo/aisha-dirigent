/**
 * Story Service — data layer for AISHA Story Feed.
 *
 * Wraps backend RPC & edge function calls for story listing, detail/thread,
 * creation, posting entries, and per-story knowledge/rules.
 *
 * All methods require authenticated state; callers must check auth before use.
 *
 * @module
 */

import { getAuthState } from "./auth";
import { authenticatedFetch, isApiReady, getBaseUrl } from "./authenticated-fetch";

// ── Types ───────────────────────────────────

export interface Story {
  id: string;
  partner_id: string;
  user_id: string;
  study_id: string | null;
  title: string;
  status: string;
  priority: string;
  is_starred: boolean;
  is_read: boolean;
  unread_count: number;
  last_activity_at: string;
  created_at: string;
  user_display_name: string | null;
  study_name: string | null;
  last_entry_preview: string | null;
  labels: Array<{ label: string; color: string }>;
  /** If this story is shared to the current user via story_participants */
  is_shared?: boolean;
  participation_role?: string;
}

export interface StoryEntry {
  id: string;
  story_id: string;
  parent_id: string | null;
  entry_type: string;
  content: string | null;
  metadata: Record<string, unknown>;
  is_internal: boolean;
  is_pinned: boolean;
  created_by: string | null;
  created_at: string;
  occurred_at: string | null;
  /** Resolved display name of the author */
  author_name?: string;
}

export interface StoryKnowledge {
  rules: string[];
  knowledge_items: Array<{ id: string; title: string; content: string }>;
}

export interface CreateStoryParams {
  title: string;
  study_id?: string;
  summary?: string;
  goals?: string[];
  constraints?: string[];
}

export interface PostEntryParams {
  story_id: string;
  content: string;
  entry_type?: string;
  parent_id?: string;
  metadata?: Record<string, unknown>;
}

// ── Helpers ─────────────────────────────────

function isReady(): boolean {
  return isApiReady();
}

async function fetchStoryById(storyId: string): Promise<Story | null> {
  const detail = await authenticatedFetch<Story[]>(
    `${getBaseUrl()}/rest/v1/rpc/get_story_detail_audited`,
    { body: { p_story_id: storyId } },
  );
  return detail.ok ? detail.data[0] ?? null : null;
}

// ── Story list ──────────────────────────────

export async function listStories(opts?: {
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<Story[]> {
  if (!isReady()) return [];

  const body: Record<string, unknown> = { p_limit: opts?.limit ?? 50 };
  if (opts?.status) body.p_status = opts.status;
  if (opts?.search) body.p_search = opts.search;
  if (opts?.offset) body.p_offset = opts.offset;

  const result = await authenticatedFetch<Story[]>(
    `${getBaseUrl()}/rest/v1/rpc/get_my_stories_audited`,
    { body },
  );

  return result.ok ? result.data : [];
}

// ── Story entries (feed/thread) ─────────────

export async function listEntries(
  storyId: string,
  opts?: { limit?: number; offset?: number },
): Promise<StoryEntry[]> {
  if (!isReady()) return [];

  const result = await authenticatedFetch<StoryEntry[]>(
    `${getBaseUrl()}/rest/v1/rpc/get_story_entries_audited`,
    {
      body: {
        p_story_id: storyId,
        p_limit: opts?.limit ?? 50,
        p_offset: opts?.offset ?? 0,
      },
    },
  );
  return result.ok ? result.data : [];
}

// ── Create story ────────────────────────────

export async function createStory(params: CreateStoryParams): Promise<Story | null> {
  if (!isReady()) return null;
  const auth = getAuthState();
  if (!auth.userId) return null;

  const result = await authenticatedFetch<string>(
    `${getBaseUrl()}/rest/v1/rpc/create_story_audited`,
    {
      body: {
        p_study_id: params.study_id ?? null,
        p_title: params.title,
        p_user_id: auth.userId,
      },
    },
  );

  if (!result.ok) return null;

  const storyId = result.data;
  if (params.summary || params.goals || params.constraints) {
    await authenticatedFetch<unknown>(
      `${getBaseUrl()}/rest/v1/rpc/update_story_project_preview`,
      {
        body: {
          p_project_preview: {
            summary: params.summary ?? "",
            goals: params.goals ?? [],
            constraints: params.constraints ?? [],
            success_criteria: [],
            meta: {},
          },
          p_publish: false,
          p_story_id: storyId,
        },
      },
    );
  }

  return fetchStoryById(storyId);
}

// ── Post entry to story thread ──────────────

export async function postEntry(params: PostEntryParams): Promise<StoryEntry | null> {
  if (!isReady()) return null;

  const body: Record<string, unknown> = {
    p_content: params.content,
    p_entry_type: params.entry_type ?? "note",
    p_is_internal: false,
    p_metadata: params.metadata ?? {},
    p_parent_id: params.parent_id ?? null,
    p_story_id: params.story_id,
  };

  const result = await authenticatedFetch<string>(
    `${getBaseUrl()}/rest/v1/rpc/create_story_entry_audited`,
    { body },
  );

  if (!result.ok) return null;

  const entries = await listEntries(params.story_id);
  const created = entries.find((entry) => entry.id === result.data);
  if (created) return created;

  return {
    id: result.data,
    story_id: params.story_id,
    parent_id: params.parent_id ?? null,
    entry_type: params.entry_type ?? "note",
    content: params.content,
    metadata: params.metadata ?? {},
    is_internal: false,
    is_pinned: false,
    created_by: null,
    created_at: new Date().toISOString(),
    occurred_at: null,
  };
}

// ── Per-story knowledge/rules (via RPC) ──────

export async function getStoryContext(storyId: string): Promise<StoryKnowledge | null> {
  if (!isReady()) return null;

  const result = await authenticatedFetch<Record<string, unknown>>(
    `${getBaseUrl()}/rest/v1/rpc/mcp_get_story_context`,
    {
      body: { p_story_id: storyId },
    },
  );

  if (!result.ok) return null;

  // Reshape mcp_get_story_context response → StoryKnowledge
  const rulesPreview = (result.data.rules_preview as Array<{ id: string; title: string; category: string }> | null) ?? [];
  return {
    rules: rulesPreview.map((r) => `[${r.category}] ${r.title}`),
    knowledge_items: [],
  };
}
