-- Index: idx_branding_hostname_mapping_profile
-- Table: branding_hostname_mapping
--
-- Lookup acceleration when an admin tool reverses the mapping (e.g. "show me
-- all hostnames pointing at brand X"). The PRIMARY KEY index on `hostname`
-- already covers the read path `LOWER(hostname) = LOWER(p_hostname)` used
-- by get_branding_for_hostname().

CREATE INDEX IF NOT EXISTS idx_branding_hostname_mapping_profile
  ON public.branding_hostname_mapping(branding_profile_id);
