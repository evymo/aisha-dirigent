/**
 * Per-service rotation manifests.
 *
 * Each service's runtime secrets are declared here with cadence + rotation
 * procedure. The OWASP A02 discovery gate verifies that every secret loaded
 * via `requireSecret(envName, ...)` either appears in a manifest entry or
 * is intentionally absent (with an exception marker).
 *
 * Cadence guidance:
 *   - `monthly`      — high-blast-radius secrets (admin tokens, master keys)
 *   - `quarterly`    — normal service-role tokens, API integrations
 *   - `annual`       — slowly-revoked keys (SLA-locked vendors)
 *   - `on_incident`  — rotate ONLY on suspected compromise (e.g. signing keys
 *                      with a long-lived chain of trust)
 */

import type { RotationManifest } from './secrets.js';

/** Master list: every entry here is the canonical rotation contract. */
export const ROTATION_MANIFESTS: ReadonlyArray<RotationManifest> = [
  {
    service: 'svc-ai-chat',
    entries: [
      { envName: 'POSTGREST_SERVICE_TOKEN', description: 'PostgREST service-role JWT for orchestration RPCs',
        cadence: 'quarterly', rotationProcedure: 'scripts/rotate-postgrest-token.sh' },
      { envName: 'OPENAI_API_KEY', description: 'OpenAI API key for LLM completion fallback',
        cadence: 'quarterly', rotationProcedure: 'OpenAI console + push via Coolify env' },
      { envName: 'ANTHROPIC_API_KEY', description: 'Anthropic API key',
        cadence: 'quarterly', rotationProcedure: 'Anthropic console + push via Coolify env' },
      { envName: 'GOOGLE_AI_API_KEY', description: 'Google Generative AI API key',
        cadence: 'quarterly', rotationProcedure: 'GCP IAM + push via Coolify env' },
      { envName: 'RAGNAROK_API_KEY', description: 'Ragnarok RAG engine integration',
        cadence: 'quarterly', rotationProcedure: 'WF_RAGNAROK_KEY_ROTATION + push via Coolify env' },
    ],
  },
  {
    service: 'svc-mcp-knowledge',
    entries: [
      { envName: 'POSTGREST_SERVICE_TOKEN', description: 'PostgREST service-role JWT',
        cadence: 'quarterly', rotationProcedure: 'scripts/rotate-postgrest-token.sh' },
      { envName: 'OPENAI_API_KEY', description: 'OpenAI embeddings key',
        cadence: 'quarterly', rotationProcedure: 'OpenAI console + Coolify env' },
    ],
  },
  {
    service: 'svc-pki-bridge',
    entries: [
      { envName: 'OPENXPKI_RPC_HMAC', description: 'OpenXPKI HMAC shared secret',
        cadence: 'quarterly', rotationProcedure: 'Coordinated with OpenXPKI realm config; runbook in docs/security/PKI_ROTATION.md' },
    ],
  },
  {
    service: 'svc-stripe',
    entries: [
      { envName: 'STRIPE_WEBHOOK_SECRET', description: 'Stripe webhook signature verification',
        cadence: 'annual', rotationProcedure: 'Stripe dashboard + Coolify env. Stripe rotates on demand.' },
    ],
  },
  {
    service: 'svc-github-app',
    entries: [
      { envName: 'GITHUB_APP_PRIVATE_KEY', description: 'GitHub App signing key for installation tokens',
        cadence: 'annual', rotationProcedure: 'GitHub App settings + Coolify env' },
    ],
  },
  {
    service: 'svc-agent-runner',
    entries: [
      { envName: 'BROKER_TOKEN_SECRET', description: 'HS256 broker token for plugin sandbox',
        cadence: 'quarterly', rotationProcedure: 'Run rotate-broker-secret.sh + restart svc-plugin-system' },
    ],
  },
  {
    service: 'svc-plugin-system',
    entries: [
      { envName: 'BROKER_TOKEN_SECRET', description: 'HS256 broker token (must match svc-agent-runner)',
        cadence: 'quarterly', rotationProcedure: 'Rotate together with svc-agent-runner' },
    ],
  },
  {
    service: 'gateway',
    entries: [
      { envName: 'JWT_SECRET', description: 'PostgREST HS256 fallback (legacy path)',
        cadence: 'quarterly', rotationProcedure: 'scripts/rotate-postgrest-token.sh covers this' },
    ],
  },
  {
    service: 'database',
    entries: [
      { envName: 'COLUMN_ENCRYPTION_KEY', description: 'pgcrypto symmetric key for aisha_encrypt_column_audited (file /run/aisha-keys/column_encryption.key, not a GUC)',
        cadence: 'on_incident', rotationProcedure: 'Re-encrypt every encrypted column under new key; staged migration with downtime window. Runbook in docs/security/COLUMN_ENCRYPTION_ROTATION.md' },
    ],
  },
];

/** Lookup helper used by the A02 discovery gate. */
export function getRotationManifest(service: string): RotationManifest | undefined {
  return ROTATION_MANIFESTS.find((m) => m.service === service);
}

/** Every env name declared across all manifests — used to verify completeness. */
export function allDeclaredSecrets(): ReadonlyArray<{ service: string; envName: string }> {
  const out: Array<{ service: string; envName: string }> = [];
  for (const m of ROTATION_MANIFESTS) {
    for (const e of m.entries) {
      out.push({ service: m.service, envName: e.envName });
    }
  }
  return out;
}
