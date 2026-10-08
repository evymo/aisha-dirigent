import { requireEnv } from '@aisha/security';
/**
 * svc-ide-context configuration
 *
 * Env-driven via `process.env`. Zod-validated at boot (see src/server.ts).
 * Pattern mirrors svc-mcp-knowledge / svc-ai-chat config conventions. No
 * hardcoded production values per `feedback_no_infra_in_repo.md` — every
 * env var has a local-dev safe default OR is required at boot.
 */
import { z } from "zod";

const keycloakUrl = requireEnv('KEYCLOAK_URL', { service: 'svc-ide-context', why: 'Dosazené `keycloak:8080` nenese prefix instance ani správný port.' });
const keycloakRealm = requireEnv('KEYCLOAK_REALM', { service: 'svc-ide-context', why: 'Realm je deklarovaná konstanta, ne výchozí hodnota.' });
/**
 * Klienti realmu, jejichž tokenům služba věří.
 *
 * ⛔ ŽÁDNÝ VÝČET V KÓDU. Do 2026-10-04 tu stál výchozí seznam tří jmen (jedno z nich ani
 * nebylo klientem realmu) a compose službě posílal proměnnou, kterou nikdo nevydával —
 * platil tedy výčet z kódu, DRUHÝ domov vedle deklarace realmu. Hodnotu skládá
 * `aisha-env-doctor` z deklarovaných OIDC klientů (platformní realm + instanční overlay) —
 * táž, kterou dostává gateway a svc-mcp-knowledge. Když chybí, služba nenastartuje:
 * nevím-li, komu věřit, není to důvod si tipnout. Seznam bez jediného jména (např. `,`)
 * projde startem, ale nevěří nikomu (auth.ts `isAllowedClient`).
 */
const kcAllowedClients = requireEnv('KC_ALLOWED_CLIENTS', {
  service: 'svc-ide-context',
  why: 'Komu služba věří, je vlastnost NASAZENÍ — skládá ji env-doctor z deklarovaných OIDC klientů.',
})
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const RawConfigSchema = z.object({
  port: z.coerce.number().int().positive().default(3050),
  logLevel: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  /** PostgREST (server-side RPC calls) */
  postgrestUrl: z.string().url().default("http://postgrest:3000"),
  postgrestServiceToken: z.string().default(""),
  postgrestJwtSecret: z.string().default(""),

  /** Keycloak OIDC */
  keycloakUrl: z.string().url().default(keycloakUrl),
  keycloakRealm: z.string().default(keycloakRealm),
  kcIssuer: z.string().url().default(`${keycloakUrl}/realms/${keycloakRealm}`),
  jwksUrl: z.string().url().default(`${keycloakUrl}/realms/${keycloakRealm}/protocol/openid-connect/certs`),
  kcAllowedClients: z.array(z.string()),

  /** OWASP hardening (@aisha/security) */
  corsAllowlist: z.string().default(""),
  rateLimitEnabled: z.boolean().default(true),

  /** Realtime subscription cadence (seconds). Used as fallback when WS drops. */
  contextRefreshSec: z.coerce.number().int().positive().default(60),

  /** Max stories / runs / approvals / audit / deploy entries per envelope.
   *  Conservative defaults to keep rendered IDE instructions under a few KB. */
  envelopeMaxStories: z.coerce.number().int().positive().default(10),
  envelopeMaxActiveRuns: z.coerce.number().int().positive().default(20),
  envelopeMaxApprovals: z.coerce.number().int().positive().default(20),
  envelopeMaxAudit: z.coerce.number().int().positive().default(30),
  envelopeMaxDeploy: z.coerce.number().int().positive().default(20),
});

export type Config = z.infer<typeof RawConfigSchema>;

function readConfig(): Config {
  const raw = {
    port: process.env.SVC_IDE_CONTEXT_PORT ?? process.env.PORT,
    logLevel: process.env.LOG_LEVEL,

    postgrestUrl: process.env.POSTGREST_URL,
    postgrestServiceToken: process.env.POSTGREST_SERVICE_TOKEN,
    postgrestJwtSecret: process.env.JWT_SECRET ?? process.env.POSTGREST_JWT_SECRET,

    keycloakUrl: process.env.KEYCLOAK_URL,
    keycloakRealm: process.env.KEYCLOAK_REALM,
    kcIssuer: process.env.KC_ISSUER,
    jwksUrl: process.env.KC_JWKS_URL,
    kcAllowedClients,

    corsAllowlist: process.env.CORS_ALLOWLIST,
    rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== "false",

    contextRefreshSec: process.env.IDE_CONTEXT_REFRESH_SEC,
    envelopeMaxStories: process.env.IDE_CONTEXT_MAX_STORIES,
    envelopeMaxActiveRuns: process.env.IDE_CONTEXT_MAX_ACTIVE_RUNS,
    envelopeMaxApprovals: process.env.IDE_CONTEXT_MAX_APPROVALS,
    envelopeMaxAudit: process.env.IDE_CONTEXT_MAX_AUDIT,
    envelopeMaxDeploy: process.env.IDE_CONTEXT_MAX_DEPLOY,
  };
  // Strip undefined so Zod defaults apply
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== undefined),
  );
  return RawConfigSchema.parse(cleaned);
}

export const config: Config = readConfig();
