import { type JWTPayload } from 'jose';
import { createJwtVerifier, AuthError as SecurityAuthError, verifyServiceRole as sharedVerifyServiceRole } from '@aisha/security';
import { config } from './config.js';

const verifier = createJwtVerifier({
  jwksUrl: config.jwksUrl,
  issuer: `${config.keycloakUrl}/realms/${config.keycloakRealm}`,
  service: 'svc-blockchain',
});

export interface VerifiedUser {
  userId: string;
  email?: string;
  roles: string[];
  claims: JWTPayload;
}

export class AuthError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export async function verifyToken(authHeader: string | undefined): Promise<VerifiedUser> {
  try {
    const user = await verifier.verify(authHeader);
    return {
      userId: user.sub,
      email: user.email,
      roles: user.realm_access?.roles ?? [],
      claims: user,
    };
  } catch (err) {
    if (err instanceof SecurityAuthError) {
      throw new AuthError(err.statusCode, err.message);
    }
    throw err;
  }
}

export function isAdminOrStaff(user: VerifiedUser): boolean {
  return user.roles.includes('admin') || user.roles.includes('staff');
}

export function verifyServiceRole(authHeader: string | undefined): void {
  // Delegates to @aisha/security so the secret compare is constant-time
  // (XOR loop instead of `!==`). The previous local implementation used
  // a short-circuit string compare, which leaks token-byte information
  // through response timing. Re-wraps upstream AuthError as the local
  // class so route handlers that check `err instanceof AuthError` keep
  // working. Status code preserved (401 missing, 403 wrong token).
  try {
    sharedVerifyServiceRole(authHeader, config.postgrestServiceToken);
  } catch (err) {
    if (err instanceof SecurityAuthError) {
      throw new AuthError(err.statusCode, err.message);
    }
    throw err;
  }
}
