/**
 * Pověření poskytovatelů AI pro svc-mcp-knowledge — z trezoru instance (administrace
 * „Poskytovatelé AI a tokeny"), přechodně z prostředí s hlasitým varováním.
 * Čtečka se zakládá líně (nic se neděje při importu); testy mockují tenhle modul.
 */
import { createCredentialReader, type CredentialReader } from '@aisha/security/credentials';
import { rpcService } from '../postgrest.js';

let ctecka: CredentialReader | undefined;

export function credentials(): CredentialReader {
  ctecka ??= createCredentialReader({
    service: 'svc-mcp-knowledge',
    rpc: (fn, params) => rpcService<unknown>(fn, params),
  });
  return ctecka;
}

/**
 * Pověření, která služba dostává v prostředí (docker-compose.coolify.yml, svc-mcp-knowledge).
 * Při startu se přesunou do trezoru instance — jen tam, kde trezor ještě nic nemá.
 */
export const POVERENI_Z_PROSTREDI = ['OPENAI_API_KEY'] as const;
