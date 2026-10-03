-- Table: guild_expertise_areas

CREATE TABLE IF NOT EXISTS public.guild_expertise_areas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  slug text NOT NULL,
  name_key text NOT NULL,
  description_key text,
  icon text DEFAULT 'code'::text,
  parent_id uuid REFERENCES public.guild_expertise_areas(id) ON DELETE SET NULL,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

ALTER TABLE public.guild_expertise_areas ENABLE ROW LEVEL SECURITY;
