import { requireEnv } from '@aisha/security';
/** svc-blockchain configuration */
export const config = {
  port: parseInt(process.env.PORT ?? '3013', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  /** PostgREST */
  postgrestUrl: requireEnv('POSTGREST_URL', { service: 'svc-blockchain', why: 'Dosazené `postgrest:3000` nenese prefix instance.' }),
  postgrestServiceToken: (process.env.POSTGREST_SERVICE_TOKEN ?? ''),

  /** Keycloak OIDC */
  keycloakUrl: requireEnv('KEYCLOAK_URL', { service: 'svc-blockchain', why: 'Dosazené `keycloak:8080` nenese prefix instance ani správný port.' }),
  keycloakRealm: requireEnv('KEYCLOAK_REALM', { service: 'svc-blockchain', why: 'Realm je deklarovaná konstanta, ne výchozí hodnota.' }),
  get jwksUrl() {
    return `${this.keycloakUrl}/realms/${this.keycloakRealm}/protocol/openid-connect/certs`;
  },

  /** Cosmos chain */
  cosmosRestUrl: process.env.COSMOS_REST_URL ?? 'http://cosmos-node:1317',
  // Tendermint/CometBFT RPC — required by cosmjs SigningStargateClient to sign+broadcast
  // (the REST LCD /txs endpoint cannot sign). Container port 26657 — reached by container
  // alias / mesh name, never a host port (docker-compose.coolify-cosmos.yml).
  cosmosRpcUrl: process.env.COSMOS_RPC_URL ?? 'http://cosmos-node:26657',
  cosmosChainId: process.env.COSMOS_CHAIN_ID ?? 'aisha-1',
  cosmosSignerAddress: process.env.COSMOS_SIGNER_ADDRESS ?? '',
  cosmosSignerMnemonic: process.env.COSMOS_SIGNER_MNEMONIC ?? '',
  cosmosGasDenom: process.env.COSMOS_GAS_DENOM ?? 'uash',
  // bech32 address prefix (cosmos1…) — derives the signer account from the mnemonic.
  // MUST match the prefix compiled into the deployed node. The node is stock
  // ghcr.io/cosmos/simapp (see Dockerfile.cosmos), which is built with the default
  // Cosmos SDK prefix 'cosmos'; init-node.sh only sets chain-id/denom at genesis and
  // CANNOT change the compiled-in prefix. A mismatched prefix derives a signer address
  // that does not exist / cannot be funded on the chain, so every on-chain tx fails.
  cosmosAddressPrefix: process.env.COSMOS_ADDRESS_PREFIX ?? 'cosmos',

  /** RabbitMQ */
  rabbitmqUrl: process.env.RABBITMQ_URL ?? 'amqp://rabbitmq:5672',

  /** Allowed origins for CORS.
   *  SoT: ALLOWED_ORIGINS from config/domains.env (pushed by deploy-init).
   *  Localhost-only fallback (same contract as gateway) — never '*': a prod
   *  deploy missing the env var must fail closed, not open CORS to the world. */
  allowedOrigins:
    process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:8100',

  /** Circuit breaker settings */
  circuitBreakerTimeoutMs: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT_MS ?? '5000', 10),

  /** Dispatch batch size */
  defaultBatchSize: 20,
  // ── OWASP hardening (@aisha/security) ──
  /** OWASP A05 — CORS allowlist (comma-separated origins). */
  corsAllowlist: process.env.CORS_ALLOWLIST ?? '',
  /** OWASP A10 — outbound host allowlist for safeFetch (comma-separated). */
  ssrfHostAllowlist: process.env.SSRF_HOST_ALLOWLIST ?? '',
  /** OWASP A04 — disable rate limiting in tests/local dev. */
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',

} as const;
