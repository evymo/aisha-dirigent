-- Table: voice_rooms

CREATE TABLE IF NOT EXISTS public.voice_rooms (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  room_type text NOT NULL,
  story_id uuid,
  livekit_room_name text NOT NULL,
  max_participants integer DEFAULT 50 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT voice_rooms_room_type_check CHECK ((room_type = ANY (ARRAY['consultation'::text, 'ptt'::text, 'group_call'::text]))),
  PRIMARY KEY (id),
  CONSTRAINT voice_rooms_livekit_room_name_key UNIQUE (livekit_room_name),
  CONSTRAINT voice_rooms_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT voice_rooms_story_id_fkey FOREIGN KEY (story_id) REFERENCES public.partner_stories(id) ON DELETE SET NULL
);

ALTER TABLE public.voice_rooms ENABLE ROW LEVEL SECURITY;
