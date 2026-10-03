/**
 * config.ts — the shared broker config shape (the dedup of svc-source-broker's
 * and a fork connector's near-identical config.ts). A concrete service extends
 * BrokerConfig with its own source-specific env and calls defineBrokerConfig to
 * load + validate. Secrets are references (resolved from the store), never baked.
 */

export interface BrokerConfig {
  serviceName: string;
  port: number;
  /** AISHA-side auth (Keycloak realm) for the admin/service route guard. */
  keycloakUrl?: string;
  keycloakRealm?: string;
  /** Gateway/cron shared service token (constant-time compared). */
  aishaGatewayIntranetKey?: string;
  /** PostgREST base — the ONLY DB path for a connector. */
  postgrestUrl?: string;
  postgrestServiceKey?: string;
  /** Explicit dev/CI bypass — MUST be false in production (asserted at boot). */
  devAllowUnauthedSync: boolean;
  nodeEnv: string;
}

export interface DefineBrokerConfigInput {
  serviceName: string;
  env?: Record<string, string | undefined>;
  defaultPort?: number;
}

/**
 * Load + validate a broker config from the environment. Fail-loud: a production
 * env with the dev bypass on is a hard error (mirrors pp4's fail-loud posture).
 */
export function defineBrokerConfig(input: DefineBrokerConfigInput): BrokerConfig {
  const env = input.env ?? process.env;
  const nodeEnv = env.NODE_ENV ?? 'development';
  const devAllowUnauthedSync = env.DEV_ALLOW_UNAUTHED_SYNC === 'true';

  if (devAllowUnauthedSync && nodeEnv === 'production') {
    throw new Error(
      `${input.serviceName}: DEV_ALLOW_UNAUTHED_SYNC=true is forbidden when NODE_ENV=production (auth bypass)`,
    );
  }

  return {
    serviceName: input.serviceName,
    port: Number(env.PORT ?? input.defaultPort ?? 8080),
    keycloakUrl: env.KEYCLOAK_URL,
    keycloakRealm: env.KEYCLOAK_REALM,
    aishaGatewayIntranetKey: env.INTRANET_API_KEY,
    postgrestUrl: env.AISHA_POSTGREST_URL,
    postgrestServiceKey: env.AISHA_POSTGREST_SERVICE_KEY,
    devAllowUnauthedSync,
    nodeEnv,
  };
}
