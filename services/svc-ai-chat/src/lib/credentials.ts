/**
 * Pověření poskytovatelů AI pro svc-ai-chat — z trezoru instance (administrace
 * „Poskytovatelé AI a tokeny"), přechodně z prostředí s hlasitým varováním.
 *
 * Čtečka se zakládá líně (až při prvním použití) a importuje se z podcesty
 * `@aisha/security/credentials`: modul tak nic nevolá při importu a testy, které
 * mockují `@aisha/security`, ji nerozbijí. Testy cest, které pověření čtou,
 * mockují tenhle modul.
 */
import { createCredentialReader, type CredentialReader } from '@aisha/security/credentials';
import { rpcService } from '../postgrest.js';

let ctecka: CredentialReader | undefined;

function reader(): CredentialReader {
  ctecka ??= createCredentialReader({
    service: 'svc-ai-chat',
    rpc: (fn, params) => rpcService<unknown>(fn, params),
  });
  return ctecka;
}

export const credentials = {
  get: (envVar: string) => reader().get(envVar),
  getMany: (envVars: readonly string[]) => reader().getMany(envVars),
  migrateEnvCredentials: (envVars: readonly string[]) => reader().migrateEnvCredentials(envVars),
  invalidate: (envVar?: string) => reader().invalidate(envVar),
};

/**
 * Pověření, která svc-ai-chat dostává v prostředí (docker-compose.coolify-ai-chat.yml).
 * Při startu se přesunou do trezoru instance — jen tam, kde trezor ještě nic nemá.
 */
export const POVERENI_Z_PROSTREDI = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY'] as const;
