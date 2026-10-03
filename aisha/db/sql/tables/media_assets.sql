-- Table: media_assets
-- Purpose: evidence nahraných médií veřejného webu (2026-09-24).
--
-- Úložiště (MinIO přes storage-auth) výpis objektů neumí a umět nemá — vypsat
-- bucket by znamenalo dát klientovi právo na `ListObjects`, tedy na celý prefix.
-- Záznam zapisuje storage-auth pod service_role ve chvíli, kdy objekt PROŠEL
-- antivirem a je v cílovém veřejném bucketu (`record_media_asset`). Galerie
-- v administraci pak čte odsud: kdo, kdy, co, kolik bajtů.
--
-- Mazání je měkké (`deleted_at`): objekt maže storage-auth (DELETE /object/…),
-- řádek zůstává jako stopa. Dvojice (bucket, object_key) je klíč objektu, takže
-- opakované ohlášení téhož nahrání je idempotentní (ON CONFLICT v RPC).

CREATE TABLE IF NOT EXISTS public.media_assets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bucket text NOT NULL,
  object_key text NOT NULL,
  content_type text NOT NULL,
  bytes bigint NOT NULL DEFAULT 0,
  original_name text,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT media_assets_bucket_object_key_key UNIQUE (bucket, object_key)
);

COMMENT ON TABLE public.media_assets IS 'Nahraná média veřejného webu — zapisuje storage-auth po průchodu antivirem; čte galerie v administraci.';

ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
