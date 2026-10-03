-- Table: consultation_sessions

CREATE TABLE IF NOT EXISTS public.consultation_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  voice_room_id uuid NOT NULL,
  booking_id uuid,
  caller_id uuid NOT NULL,
  callee_id uuid NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  started_at timestamp with time zone,
  ended_at timestamp with time zone,
  duration_seconds integer,
  recording_consent boolean DEFAULT false NOT NULL,
  recording_url text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  recording_consent_at timestamp with time zone,
  recording_egress_id text,
  CONSTRAINT consultation_sessions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'ringing'::text, 'active'::text, 'ended'::text, 'missed'::text, 'declined'::text]))),
  PRIMARY KEY (id),
  CONSTRAINT consultation_sessions_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.consultation_bookings(id) ON DELETE SET NULL,
  CONSTRAINT consultation_sessions_callee_id_fkey FOREIGN KEY (callee_id) REFERENCES aisha_auth.users(id),
  CONSTRAINT consultation_sessions_caller_id_fkey FOREIGN KEY (caller_id) REFERENCES aisha_auth.users(id),
  CONSTRAINT consultation_sessions_voice_room_id_fkey FOREIGN KEY (voice_room_id) REFERENCES public.voice_rooms(id) ON DELETE CASCADE
);

ALTER TABLE public.consultation_sessions ENABLE ROW LEVEL SECURITY;
