-- Index: idx_user_roles_role
-- Table: user_roles

CREATE INDEX idx_user_roles_role ON public.user_roles USING btree (role);
