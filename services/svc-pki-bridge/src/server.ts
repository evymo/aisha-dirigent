import Fastify, { type FastifyError, type FastifyRequest, type FastifyReply } from 'fastify';
import { readFileSync, existsSync } from 'node:fs';
import { applySecurity, pluginRejection } from '@aisha/security';
import { bootstrapOtel } from '@aisha/observability/otel';
import { registerMetricsPlugin } from '@aisha/observability/metrics';
import { config } from './config.js';
import { AuthError } from './auth.js';
import { issueRoutes } from './routes/issue.js';
import { diagRoutes } from './routes/diag.js';


// Phase 12 WP 0.4 — OTel auto-instrumentation must attach before any
// other module performs network I/O. Exporter routes to Langfuse OTLP.
// Rollback: OTEL_SDK_DISABLED=true env (Coolify) + container restart.
bootstrapOtel({ serviceName: 'svc-pki-bridge' });
const app = Fastify({ logger: { level: config.logLevel }, trustProxy: true });

await applySecurity(app, {
  service: 'svc-pki-bridge',
  cors: { allowlist: config.corsAllowlist },
  rateLimit: { enabled: config.rateLimitEnabled, max: 60, timeWindow: 60_000 },
  skipErrorHandler: true,
});

await registerMetricsPlugin(app, { serviceName: 'svc-pki-bridge' });

app.setErrorHandler((error: FastifyError | AuthError, _req: FastifyRequest, reply: FastifyReply) => {
  if (error instanceof AuthError) {
    // Server-side: log detail (which jose claim failed, expected vs actual)
    // so operators see real cause instead of guessing through the generic
    // client-facing message. Client still gets only { error: msg }.
    app.log.warn({ msg: error.message, ...(error.detail ?? {}) }, 'auth rejected');
    return reply.status(error.statusCode).send({ error: error.message });
  }
  // 4xx z pluginu (limit 429, validace 400) je odpověď volajícímu, ne porucha.
  const odmitnuti = pluginRejection(error);
  if (odmitnuti) return reply.status(odmitnuti.statusCode).send(odmitnuti.body);
  app.log.error(error);
  return reply.status(500).send({ error: 'Internal server error' });
});

app.get('/health', async () => ({
  status: 'ok',
  service: 'svc-pki-bridge',
  audience: config.jwtAudience,
  realm: config.openxpkiRealm,
  // Expose the exact issuer + jwks URLs so operators can curl /health to
  // verify what pki-bridge will compare against. No secrets here, only the
  // public expectations (which a token caller must already know to call us).
  expected_issuer: config.expectedIssuer,
  jwks_url: config.jwksUrl, // Internal Docker DNS — see config.ts comment
}));


/**
 * /diag/ca-bundle — single-source-of-truth AISHA CA trust bundle.
 *
 * Reads the per-instance `rootca-<realm>.crt` files OpenXPKI's
 * pki-realm-bootstrap.sh generated at first boot and concatenates them
 * into a PEM bundle. Consumers (pki-init scripts in netbird / langfuse /
 * other stacks; mesh agents) call this on each deploy to refresh their
 * `aisha-ca-bundle.pem` from the live source.
 *
 * Replaces the static `config/pki/aisha-ca-bundle.pem` committed to git —
 * that file was last refreshed 2026-04-13 and went stale the moment a
 * cold-start `--wipe` regenerated the rootcas with fresh keys, leaving
 * every consumer with a bundle that didn't match the per-instance trust
 * anchors → `error 20 at depth 0: unable to get local issuer certificate`
 * cascades. Per-deploy fetch from this endpoint guarantees the bundle is
 * always aligned with whatever pki-server actually trusts right now.
 *
 * Realm scope (matches `pki-realm-bootstrap.sh:REALMS`):
 *   - identity-plane
 *   - data-plane
 *   - orchestration-plane
 *
 * No auth: trust anchors are public (the whole point is for consumers
 * to fetch them anonymously and pin them as trusted CAs). Private keys
 * (rootca-<realm>.key) live in the same dir but are NEVER read here.
 * The handler is explicit about which files it reads to avoid accidental
 * key exposure on a future filename change.
 *
 * Returns text/plain (concatenated PEM blocks). Empty body if no rootcas
 * exist yet (pki-server still bootstrapping) — consumer should retry.
 */
app.get('/diag/ca-bundle', async (_req, reply) => {
  // The 3 realms that pki-realm-bootstrap.sh provisions. If a new realm
  // ever gets added, declare it here too — explicit > glob to keep an
  // accidental new file (a leaked private key, a SCEP CA, etc.) from
  // sneaking into the public bundle.
  const REALMS = ['identity-plane', 'data-plane', 'orchestration-plane'] as const;
  const keysDir = '/etc/openxpki/local/keys';
  const pieces: string[] = [];
  const missing: string[] = [];
  for (const realm of REALMS) {
    const path = `${keysDir}/rootca-${realm}.crt`;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path built from typed REALMS constant + fixed prefix; no user input
    if (!existsSync(path)) {
      missing.push(realm);
      continue;
    }
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- same as above
      const pem = readFileSync(path, 'utf8').trim();
      if (pem.includes('BEGIN CERTIFICATE')) {
        pieces.push(pem);
      } else {
        missing.push(`${realm}(empty)`);
      }
    } catch (err) {
      missing.push(`${realm}(read-error: ${(err as Error).message})`);
    }
  }

  // Headers: surface what was assembled so operators can diff a bad bundle
  // against expected realms without parsing the PEM. fp_realms helps catch
  // partial-rotation states (e.g. one realm re-bootstrapped, two stale).
  reply.header('content-type', 'application/x-pem-file; charset=utf-8');
  reply.header('x-aisha-bundle-realms', REALMS.length > 0 ? REALMS.join(',') : '(none)');
  if (missing.length > 0) {
    reply.header('x-aisha-bundle-missing', missing.join(','));
  }
  return pieces.length > 0 ? pieces.join('\n') + '\n' : '';
});


await app.register(diagRoutes);
await app.register(issueRoutes);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`svc-pki-bridge listening on :${config.port} (realm: ${config.openxpkiRealm})`);
} catch (err) {
  app.log.fatal(err);
  process.exit(1);
}
