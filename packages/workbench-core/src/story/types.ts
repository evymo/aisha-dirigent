/**
 * Story domain types — shared between the extension, workbench, and tests.
 *
 * Extracted from extensions/aisha-dirigent/src/story-service.ts so that
 * custom hooks in the main app and the extension share the same shapes.
 *
 * @module
 */

/** A story / project as returned by get_my_stories_audited. */
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
  is_shared?: boolean;
  participation_role?: string;
}

/** A single entry in the story timeline. */
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
  author_name?: string;
}

/** Knowledge snapshot attached to a story. */
export interface StoryKnowledge {
  rules: string[];
  knowledge_items: Array<{ id: string; title: string; content: string }>;
}

/** Parameters for creating a new story. */
export interface CreateStoryParams {
  title: string;
  summary?: string;
  goals?: string[];
  constraints?: string[];
}

/** Parameters for posting a new entry to a story. */
export interface PostEntryParams {
  story_id: string;
  content: string;
  entry_type?: string;
  parent_id?: string;
  metadata?: Record<string, unknown>;
}

/** Lightweight story item used in pickers and lists. */
export interface StoryItem {
  id: string;
  title: string;
  status: string;
  is_shared?: boolean;
  participation_role?: string;
}

/** Template type enum — matches story_templates.type DB column. */
export type StoryTemplateType = "web_page" | "hero" | "section" | "component" | "layout";

/** A reusable story template stored in the story_templates table. */
export interface StoryTemplate {
  id: string;
  story_id: string | null;
  name: string;
  type: StoryTemplateType;
  version: number;
  content: Record<string, unknown>;
  is_published: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}
