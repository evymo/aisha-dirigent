-- Index: idx_profiles_email
-- Table: profiles

CREATE INDEX idx_profiles_email ON public.profiles USING btree (email);
