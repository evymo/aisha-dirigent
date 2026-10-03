import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';

const trimSlash = (value: string): string => value.replace(/\/+$/, '');

function envValue(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return '';
}

/**
 * Normalize a bare domain (`api.acme.com`) OR a full URL to a trimmed
 * `https://…` URL. Empty in → empty out. The domain env vars (API_DOMAIN_PUBLIC,
 * GATEWAY_DOMAIN_PUBLIC, APP_DOMAIN) are hostnames, not URLs — this makes them
 * usable as public bootstrap URLs without hardcoding a scheme elsewhere.
 */
function toHttpsUrl(value: string): string {
  const v = value.trim().replace(/\/+$/, '');
  if (!v) return '';
  if (/\.invalid(\b|$)/i.test(v)) return ''; // derive-domains sentinel = feature off
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

function deriveKeycloakUrl(): string {
  const explicit = envValue('APP_CONFIG_KEYCLOAK_URL');
  if (explicit) return trimSlash(explicit);

  // Refuse to derive if realm is unset (cold-start populates it).
  const realm = envValue('KEYCLOAK_REALM');
  if (!realm) return '';

  // Derive the KC host UNCONDITIONALLY from the per-instance domain vars — no
  // donor TLD literals (a fork must get ITS OWN keycloak_url, not an empty one
  // because its hostname isn't *.aisha.guru). Public face wins; internal is the
  // fallback when no public zone is set (community single-host).
  const publicDomain = envValue('AUTH_DOMAIN_PUBLIC', 'KEYCLOAK_DOMAIN_PUBLIC');
  if (publicDomain) return `https://${trimSlash(publicDomain)}/realms/${realm}`;
  const internalDomain = envValue('KEYCLOAK_DOMAIN');
  if (internalDomain) return `https://${trimSlash(internalDomain)}/realms/${realm}`;
  return '';
}

export const appConfigRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/.well-known/app-config.json', async (_req: FastifyRequest, reply: FastifyReply) => {
    const anonKey = envValue(
      'ANON_KEY',
      'AISHA_ANON_KEY',
      'VITE_AISHA_BACKEND_ANON_KEY',
      'VITE_AISHA_GATEWAY_KEY',
    );

    if (!anonKey) {
      return reply.status(503).send({
        error: 'app_config_unavailable',
        message: 'ANON_KEY is not configured for public app bootstrap.',
      });
    }

    // Public bootstrap URLs — external clients (cockpit, VS Code / Claude / Zed
    // extensions, mobile app) fetch this to learn where the stack lives. PREFER
    // the derived public domains (API_DOMAIN_PUBLIC / APP_DOMAIN /
    // GATEWAY_DOMAIN_PUBLIC=ask.<tld>, emitted by derive-domains) over the
    // gateway's own PUBLIC_URL/FRONTEND_URL — the latter default to localhost and
    // silently break every external client's bootstrap when unset (they only make
    // sense for a same-host caller). APP_CONFIG_* overrides win when set.
    const aishaUrl =
      toHttpsUrl(envValue('APP_CONFIG_AISHA_URL', 'API_DOMAIN_PUBLIC')) || trimSlash(config.publicUrl);
    const webUrl =
      toHttpsUrl(envValue('APP_CONFIG_WEB_URL', 'APP_DOMAIN')) || trimSlash(config.frontendUrl);
    // ask_url — the "AISHA as a model" PUBLIC /v1 face (ANTHROPIC_BASE_URL for
    // IDE napoj). GATEWAY_DOMAIN_PUBLIC is the host (ask.<tld>); append /v1.
    const askBase = toHttpsUrl(envValue('APP_CONFIG_ASK_URL', 'GATEWAY_DOMAIN_PUBLIC'));
    const askUrl = askBase ? (/\/v1\/?$/.test(askBase) ? trimSlash(askBase) : `${askBase}/v1`) : '';
    const matrixHomeserverUrl = trimSlash(
      envValue('APP_CONFIG_MATRIX_HOMESERVER_URL') || '',
    );

    return reply
      .header('Cache-Control', 'public, max-age=300')
      .send({
        aisha_url: aishaUrl,
        ask_url: askUrl,
        anon_key: anonKey,
        keycloak_url: deriveKeycloakUrl(),
        redirect_url: envValue('APP_CONFIG_REDIRECT_URL') || 'aisha-dirigent://oauth-callback',
        matrix_homeserver_url: matrixHomeserverUrl,
        matrix_service_url: trimSlash(
          envValue('APP_CONFIG_MATRIX_SERVICE_URL') || `${aishaUrl}/functions/v1/matrix-token-exchange`,
        ),
        mcp_url: trimSlash(envValue('APP_CONFIG_MCP_URL') || `${aishaUrl}/functions/v1/mcp-knowledge-server`),
        orchestration_url: trimSlash(envValue('APP_CONFIG_ORCHESTRATION_URL') || ''),
        n8n_trigger_url: trimSlash(
          envValue('APP_CONFIG_N8N_TRIGGER_URL') || `${aishaUrl}/admin/n8n-trigger`,
        ),
        web_url: webUrl,
        version: 3,
      });
  });
};
