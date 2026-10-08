/**
 * Pověření runneru — z trezoru instance (administrace „Poskytovatelé AI a tokeny"),
 * ne z prostředí načteného při startu.
 *
 * Token Claude (AGENT_CLAUDE_OAUTH_TOKEN) i klíče se čtou V OKAMŽIKU BĚHU: změna
 * v administraci platí pro další běh bez restartu (mezipaměť čtečky ~60 s). Které
 * pověření patří kterému CLI nástroji, říká katalog (ai_runtime_registry.
 * credential_env_var pro cli:<slug>) — runner žádný seznam nástrojů nedrží.
 */
import { createCredentialReader } from '@aisha/security';
import { rpcService } from './db.js';

export const credentials = createCredentialReader({
  service: 'svc-agent-runner',
  rpc: (fn, params) => rpcService<unknown>(fn, params),
});

/**
 * Pověření, která runner dostává v prostředí (docker-compose.coolify-exec.yml).
 * Při startu se přesunou do trezoru instance — jen tam, kde trezor ještě nic nemá.
 */
export const POVERENI_Z_PROSTREDI = ['AGENT_CLAUDE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'] as const;

/**
 * Jméno pověření, které deklaruje runtime (`cli:<slug>`), nebo null — runtime
 * žádné nedeklaruje. Odvozeno z katalogu (used_by kind='runtime').
 */
export async function credentialNameForRuntime(runtimeSlug: string): Promise<string | null> {
  const katalog = await credentials.catalog();
  const hit = katalog.find((e) => e.used_by.some((u) => u.kind === 'runtime' && u.slug === runtimeSlug));
  return hit?.env_var ?? null;
}
