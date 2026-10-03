-- Table: call_participants

CREATE TABLE IF NOT EXISTS public.call_participants (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  voice_room_id uuid NOT NULL,
  user_id uuid NOT NULL,
  joined_at timestamp with time zone DEFAULT now() NOT NULL,
  left_at timestamp with time zone,
  is_muted boolean DEFAULT false NOT NULL,
  role text DEFAULT 'participant'::text NOT NULL,
  CONSTRAINT call_participants_role_check CHECK ((role = ANY (ARRAY['host'::text, 'participant'::text, 'listener'::text]))),
  PRIMARY KEY (id),
  CONSTRAINT call_participants_voice_room_id_user_id_key UNIQUE (voice_room_id, user_id),
  CONSTRAINT call_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id),
  CONSTRAINT call_participants_voice_room_id_fkey FOREIGN KEY (voice_room_id) REFERENCES public.voice_rooms(id) ON DELETE CASCADE
);

ALTER TABLE public.call_participants ENABLE ROW LEVEL SECURITY;
