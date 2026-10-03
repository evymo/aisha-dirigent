-- Table: call_events

CREATE TABLE IF NOT EXISTS public.call_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  voice_room_id uuid NOT NULL,
  user_id uuid,
  event_type text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT call_events_event_type_check CHECK ((event_type = ANY (ARRAY['room_created'::text, 'room_closed'::text, 'participant_joined'::text, 'participant_left'::text, 'recording_started'::text, 'recording_stopped'::text, 'ptt_activated'::text, 'ptt_deactivated'::text]))),
  PRIMARY KEY (id),
  CONSTRAINT call_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id),
  CONSTRAINT call_events_voice_room_id_fkey FOREIGN KEY (voice_room_id) REFERENCES public.voice_rooms(id) ON DELETE CASCADE
);

ALTER TABLE public.call_events ENABLE ROW LEVEL SECURITY;
