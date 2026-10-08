/**
 * Pověření poskytovatelů AI pro svc-health-ai — z trezoru instance (administrace
 * „Poskytovatelé AI a tokeny"), přechodně z prostředí s hlasitým varováním.
 * Čtečka se zakládá líně (nic se neděje při importu).
 */
import { createCredentialReader, type CredentialReader } from '@aisha/security/credentials';
import { rpcService } from './postgrest.js';

let ctecka: CredentialReader | undefined;

export function credentials(): CredentialReader {
  ctecka ??= createCredentialReader({
    service: 'svc-health-ai',
    rpc: (fn, params) => rpcService<unknown>(fn, params),
  });
  return ctecka;
}
