-- Function: public.edge_app_secrets
-- Purpose: Backend-only read/write access to API secrets via Postgres vault (encrypted at rest).
-- Storage: Reads from vault.decrypted_secrets, writes via vault.create_secret/update_secret.
-- Security: SECURITY DEFINER, service_role only

CREATE OR REPLACE FUNCTION public.edge_app_secrets(
  p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_user_id uuid;
  v_key text;
  v_updated_by uuid;
  v_value text;
  v_existing_id uuid;
  v_description text;
BEGIN
  -- ── get_many: Read secrets from Vault ──────────────────────────
  IF p_action = 'get_many' THEN
    RETURN jsonb_build_object(
      'rows',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'key', ds.name,
              'updated_at', ds.updated_at,
              'updated_by', CASE
                WHEN ds.description IS NOT NULL
                  AND ds.description ~ '^\{' -- is JSON
                THEN ds.description::jsonb ->> 'updated_by'
                ELSE NULL
              END,
              'value', ds.decrypted_secret
            )
          )
          FROM vault.decrypted_secrets ds
          WHERE ds.name = ANY(
            COALESCE(
              (
                SELECT array_agg(val)
                FROM jsonb_array_elements_text(
                  COALESCE(p_payload -> 'keys', '[]'::jsonb)
                ) AS t(val)
              ),
              ARRAY[]::text[]
            )
          )
        ),
        '[]'::jsonb
      )
    );
  END IF;

  -- ── upsert_admin: Write secret to Vault ────────────────────────
  IF p_action = 'upsert_admin' THEN
    v_actor_user_id := NULLIF(p_payload ->> 'actor_user_id', '')::uuid;
    v_key := NULLIF(p_payload ->> 'key', '');
    v_updated_by := NULLIF(p_payload ->> 'updated_by', '')::uuid;
    v_value := p_payload ->> 'value';

    IF v_actor_user_id IS NULL OR v_key IS NULL OR v_value IS NULL OR btrim(v_value) = '' THEN
      RAISE EXCEPTION 'Missing required payload fields';
    END IF;

    IF NOT public.has_role(v_actor_user_id, 'admin') THEN
      RAISE EXCEPTION 'Unauthorized: admin role required';
    END IF;

    v_description := jsonb_build_object(
      'updated_by', COALESCE(v_updated_by, v_actor_user_id)
    )::text;

    -- Check if secret already exists in vault
    SELECT id INTO v_existing_id FROM vault.secrets WHERE name = v_key;

    IF v_existing_id IS NOT NULL THEN
      PERFORM vault.update_secret(
        v_existing_id,   -- secret_id
        v_value,         -- new_secret (will be re-encrypted)
        v_key,           -- new_name
        v_description    -- new_description
      );
    ELSE
      PERFORM vault.create_secret(
        v_value,         -- new_secret (will be encrypted)
        v_key,           -- new_name
        v_description    -- new_description
      );
    END IF;

    RETURN jsonb_build_object('ok', true);
  END IF;

  RAISE EXCEPTION 'Unsupported action: %', p_action;
END;
$function$;

REVOKE ALL ON FUNCTION public.edge_app_secrets(text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.edge_app_secrets(text, jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.edge_app_secrets(text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.edge_app_secrets(text, jsonb) TO service_role;

COMMENT ON FUNCTION public.edge_app_secrets(text, jsonb) IS
  'Backend-only read/write for API secrets. Storage: Postgres vault (encrypted). Migrated from app_secrets table.';
