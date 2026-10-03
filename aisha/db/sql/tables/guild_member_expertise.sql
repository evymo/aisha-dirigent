-- Table: guild_member_expertise

CREATE TABLE IF NOT EXISTS public.guild_member_expertise (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  partner_id uuid NOT NULL REFERENCES public.partner_profiles ON DELETE CASCADE,
  expertise_area_id uuid NOT NULL,
  proficiency_level integer DEFAULT 1 NOT NULL,
  years_experience integer,
  description text,
  is_primary boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

ALTER TABLE public.guild_member_expertise ENABLE ROW LEVEL SECURITY;
