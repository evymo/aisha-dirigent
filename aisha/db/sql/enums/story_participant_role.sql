-- Enum: story_participant_role
-- Replaces the free-text story_participants.role column with a strict
-- enum so the RLS policies + UI surfaces can rely on a small, stable set
-- of roles. Existing rows are migrated by 20260520400000_story_participants_role_enum.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'story_participant_role') THEN
    CREATE TYPE public.story_participant_role AS ENUM (
      'owner',           -- legacy 'partner' rows migrate here; full read/write
      'collaborator',    -- invited member; read + comment, no destructive actions
      'viewer',          -- read-only; no comment / no mutation
      'agent_supervisor' -- can govern AISHA's behavior on this story (bindings, hippocampus)
    );
  END IF;
END $$;
