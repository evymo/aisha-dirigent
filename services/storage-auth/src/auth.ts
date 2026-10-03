import { type JWTPayload } from 'jose';
import { createJwtVerifier, AuthError as SecurityAuthError } from '@aisha/security';
import { config } from './config.js';

const verifier = createJwtVerifier({
  jwksUrl: config.jwksUrl,
  issuer: `${config.keycloakUrl}/realms/${config.keycloakRealm}`,
  service: 'storage-auth',
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
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthError(401, 'Missing or invalid Authorization header');
  }
  if (authHeader.slice(7) !== config.postgrestServiceToken) {
    throw new AuthError(401, 'Invalid service-role token');
  }
}
