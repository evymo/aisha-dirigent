-- Table: story_matrix_rooms

CREATE TABLE IF NOT EXISTS public.story_matrix_rooms (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  story_id uuid NOT NULL,
  matrix_room_id text NOT NULL,
  room_type text DEFAULT 'general'::text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  -- Added by migration 20260416140000_realtime_comms_rpc_functions via
  -- ALTER ADD COLUMN. Required by create_story_matrix_room INSERT and
  -- get_story_matrix_rooms SELECT. A later table re-extract dropped them from
  -- the deployed schema, leaving both RPCs broken — restored here.
  bridge_type text,
  display_name text,
  CONSTRAINT story_matrix_rooms_room_type_check CHECK ((room_type = ANY (ARRAY['general'::text, 'voice'::text, 'bridge'::text, 'bot'::text]))),
  PRIMARY KEY (id),
  CONSTRAINT story_matrix_rooms_story_id_room_type_key UNIQUE (story_id, room_type),
  CONSTRAINT story_matrix_rooms_story_id_fkey FOREIGN KEY (story_id) REFERENCES public.partner_stories(id) ON DELETE CASCADE
);

ALTER TABLE public.story_matrix_rooms ENABLE ROW LEVEL SECURITY;
