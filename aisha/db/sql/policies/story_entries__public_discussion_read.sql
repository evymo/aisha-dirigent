-- Policy: story_entries_public_discussion_read
-- Lets any authenticated member READ visible, non-internal discussion entries
-- that hang off PUBLIC content nodes (news_article, web_page) — the generic
-- "discussion under an article/page" surface created by
-- create_discussion_entry_audited. Scoped by subject_type ON PURPOSE: a blanket
-- "status = 'visible'" SELECT would leak member-private story entries. Story +
-- knowledge_topic entries keep their own (restrictive) policies; topic-discussion
-- read (visibility-respecting) is a follow-up. PERMISSIVE OR with the admin-manage
-- + participant-read policies.

CREATE POLICY "story_entries_public_discussion_read"
  ON public.story_entries
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    status = 'visible'
    AND is_internal = false
    AND subject_type IN ('news_article', 'web_page')
  );
