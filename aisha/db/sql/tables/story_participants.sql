-- Table: story_participants

CREATE TABLE IF NOT EXISTS public.story_participants (
  story_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  joined_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (story_id, user_id, role)
);

ALTER TABLE public.story_participants ENABLE ROW LEVEL SECURITY;
