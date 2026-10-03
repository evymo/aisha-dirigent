/**
 * ACS intent canonicalization (IP-6). Dynamic imports — inert under ACS_MODE=off.
 */
import { createSafeLogger } from '@aisha/security';
import { acsGlobalMode } from './guard.js';

const log = createSafeLogger('acs-intent');

export async function ensureIntent(input: {
  canonical: unknown;
  createdBy: string;
  sourceClass?: 'internal' | 'partner' | 'byod' | 'public';
  aiRunId?: string | null;
  intentId?: string;
}): Promise<string | null> {
  if (acsGlobalMode() === 'off') return null;
  const [{ createHash }, sdk, { rpcService }] = await Promise.all([
    import('node:crypto'),
    import('@aisha/acs-sdk'),
    import('../../postgrest.js'),
  ]);
  const id = input.intentId ?? sdk.intentId();
  const canonical = { canonical: input.canonical };
  const sha = createHash('sha256').update(sdk.canonicalJson(canonical)).digest('hex');
  try {
    await rpcService('acs_create_intent', {
      p_ai_run_id: input.aiRunId ?? null,
      p_canonical: canonical,
      p_content_sha256: sha,
      p_created_by: input.createdBy,
      p_intent_id: id,
      p_source_class: input.sourceClass ?? 'internal',
    });
    return id;
  } catch (err) {
    log.safeError('ACS ensureIntent failed', err);
    if (acsGlobalMode() === 'enforce') throw err;
    return null;
  }
}
