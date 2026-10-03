/**
 * OWASP A02 — Cryptographic Failures: secret loading & rotation helpers.
 *
 * We do not implement a vault — secrets reach the process via env vars set by
 * Coolify/Docker. This module enforces:
 *
 *   1. `requireSecret(name, opts)` — fail-fast at boot if a required secret
 *      is missing or trivially weak. Prevents the orchestrator from starting
 *      with `JWT_SECRET=changeme`.
 *   2. `redactSecret(value)` — turn any secret into a short fingerprint
 *      `[secret:abc1...]` for safe logging.
 *   3. `RotationManifest` — declarative description of which secrets rotate
 *      on what schedule. Consumed by the rotation runbook generator.
 *
 * Rationale for env-only: AISHA already has Coolify `/envs/bulk` PATCH as the
 * canonical secret push path (see feedback_bootstrap_creds_generator_pushes.md).
 * Adding a Vault/KMS layer would duplicate trust roots without a clear win.
 */

import { createHash } from 'node:crypto';
import { createSafeLogger } from './logger.js';

const WEAK_VALUES = new Set([
  'changeme',
  'password',
  '12345',
  '123456',
  'admin',
  'secret',
  'token',
  'aisha',
  'test',
  '',
]);

export interface RequireSecretOptions {
  /** Minimum length in characters (after trim). Default 16. */
  minLength?: number;
  /** Service name for log tagging. */
  service: string;
  /** When true, allows the secret to be missing and returns null. */
  optional?: boolean;
}

export class MissingSecretError extends Error {
  /** The environment variable name that failed validation. */
  public readonly envName: string;
  constructor(envName: string, message: string) {
    super(message);
    this.name = 'MissingSecretError';
    this.envName = envName;
  }
}

export function requireSecret(envName: string, opts: RequireSecretOptions): string {
  const { minLength = 16, service, optional = false } = opts;
  const raw = process.env[envName];
  const value = raw?.trim() ?? '';
  if (!value) {
    if (optional) return '';
    throw new MissingSecretError(envName, `Required secret env ${envName} is not set`);
  }
  if (value.length < minLength) {
    throw new MissingSecretError(envName, `Secret ${envName} is too short (<${minLength} chars)`);
  }
  if (WEAK_VALUES.has(value.toLowerCase())) {
    throw new MissingSecretError(envName, `Secret ${envName} matches a known-weak value`);
  }
  // Log only that the secret was loaded — never the value, never the length.
  createSafeLogger(`secrets:${service}`).safeInfo('secrets.loaded', { name: envName });
  return value;
}

/** Return a short stable fingerprint of a secret, safe for logs. */
export function fingerprintSecret(value: string): string {
  if (!value) return '[secret:empty]';
  const h = createHash('sha256').update(value).digest('hex');
  return `[secret:${h.slice(0, 8)}]`;
}

export interface RotationManifestEntry {
  /** Env var name. */
  envName: string;
  /** Human-readable description of where the secret is used. */
  description: string;
  /** Rotation cadence — `quarterly` is the default for AISHA secrets. */
  cadence: 'monthly' | 'quarterly' | 'annual' | 'on_incident';
  /** Script or runbook step that performs the rotation. */
  rotationProcedure: string;
}

/** Service-level rotation manifest — consumed by the rotation runbook generator. */
export interface RotationManifest {
  service: string;
  entries: RotationManifestEntry[];
}

/** Format a manifest as markdown for inclusion in service README/docs. */
export function formatRotationManifest(m: RotationManifest): string {
  const rows = m.entries
    .map(
      (e) =>
        `| \`${e.envName}\` | ${e.description} | ${e.cadence} | ${e.rotationProcedure} |`,
    )
    .join('\n');
  return `## Secret rotation — ${m.service}

| Env | Description | Cadence | Procedure |
|-----|-------------|---------|-----------|
${rows}
`;
}
