import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { getBrokerSecretBytes } from './broker-secret.js';

export interface BrokerTokenPayload {
  sub: string;
  kind: string;
  source_ref: string;
  user_id: string;
  /**
   * Tenant běhu pluginu (plugin-exec) — broker podle něj vydá konfiguraci
   * (/sandbox/config). Autorizoval ho host (svc-plugin-system), který runner
   * volá servisním tokenem; u ostatních druhů běhu prázdný.
   */
  tenant_id: string;
}

export async function issueBrokerToken(payload: BrokerTokenPayload, timeoutMs: number): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + Math.ceil(timeoutMs / 1000) + 60)
    .setAudience('aisha-plugin-broker')
    .sign(getBrokerSecretBytes());
}

export async function verifyBrokerToken(token: string): Promise<JWTPayload & BrokerTokenPayload> {
  const { payload } = await jwtVerify(token, getBrokerSecretBytes(), { audience: 'aisha-plugin-broker' });
  return payload as JWTPayload & BrokerTokenPayload;
}
