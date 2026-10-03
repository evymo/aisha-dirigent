import { createJwtVerifier, AuthError as SecurityAuthError, verifyServiceRole as sharedVerifyServiceRole } from '@aisha/security';
import { config } from './config.js';

const verifier = createJwtVerifier({
  jwksUrl: config.jwksUrl,
  issuer: `${config.keycloakUrl}/realms/${config.keycloakRealm}`,
  service: 'svc-agent-runner',
});

export interface VerifiedUser {
  userId: string;
  email: string;
  roles: string[];
  isServiceRole?: boolean;
}

export class AuthError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 401) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function verifyToken(authHeader: string | undefined): Promise<VerifiedUser> {
  try {
    sharedVerifyServiceRole(authHeader, config.postgrestServiceToken);
    return {
      userId: 'service_role',
      email: '',
      roles: ['service_role', 'agent:run'],
      isServiceRole: true,
    };
  } catch {
    // Fall through to Keycloak JWT verification. A valid user JWT will not match
    // the shared service-role token, and an unset service token must not disable
    // normal user auth.
  }

  try {
    const user = await verifier.verify(authHeader);
    return {
      userId: String(user.sub),
      email: String(user.email ?? ''),
      roles: user.realm_access?.roles ?? [],
    };
  } catch (err) {
    if (err instanceof SecurityAuthError) {
      throw new AuthError(err.message, err.statusCode);
    }
    throw err;
  }
}

export function requireRunnerOperator(user: VerifiedUser): void {
  if (
    user.isServiceRole === true ||
    user.roles.includes('service_role') ||
    user.roles.includes('agent:run') ||
    user.roles.includes('admin') ||
    user.roles.includes('staff')
  ) {
    return;
  }
  throw new AuthError('Insufficient agent-runner role', 403);
}
