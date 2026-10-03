import type { FastifyInstance, FastifyRequest } from 'fastify';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { getJwksCacheInfo, verifyToken } from '../auth.js';
import { fp } from '../fp.js';

/**
 * Diagnostic routes for svc-pki-bridge, extracted from server.ts into a plugin
 * so they are unit-testable (register on a bare Fastify app + inject).
 *
 * M-D6: /diag and /diag/openxpki-state are now AUTH-GATED (verifyToken) — they
 * expose secret fingerprints, JWKS/kid state, the rendered RPC HMAC fp, and
 * (openxpki-state) tails of audit.log/workflows.log/openxpki.log. audit.log is
 * the private-key + secret ACCESS log, so an unauthenticated read leaks the
 * operational security posture of the mesh TLS trust anchor. /diag/ca-bundle
 * and /health stay UNAUTH by design (see server.ts): trust anchors are public
 * and the healthcheck must not require a token.
 */

/**
 * Probe OpenXPKI RPC reachability without going through the full enrollment
 * workflow. Sends a HEAD-style trivial body with a 5s timeout. Surfaces:
 *   - reachable: TCP+HTTP layer alive (any HTTP response is OK)
 *   - status: actual HTTP code (200/4xx = healthy backend; 504/timeout = hung)
 *   - error: detailed network/timeout error if unreachable
 *
 * Differentiates "pki-webui down" from "OpenXPKI workflow hangs on cert
 * enrollment" — the latter would return success here but timeout on /v1/issue.
 */
async function probeOpenxpkiRpc(): Promise<{ reachable: boolean; status?: number; error?: string; ms?: number }> {
  const url = `${config.openxpkiRpcUrl}/${config.openxpkiRealm}/RequestCertificate`;
  const start = Date.now();
  try {
    // Send a "ping" — invalid body, but the RPC dispatcher should return
    // 200 with an error payload (NOT hang). 5s timeout: if the call returns
    // we know the dispatcher is responsive; if it times out, OpenXPKI is hung.
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'TestConnection' }),
      signal: AbortSignal.timeout(5000),
    });
    return { reachable: true, status: res.status, ms: Date.now() - start };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return { reachable: false, error: `${e.code ?? '?'}: ${e.message ?? '?'}`, ms: Date.now() - start };
  }
}

export async function diagRoutes(app: FastifyInstance): Promise<void> {
  /**
   * /diag — operator diagnostic endpoint.
   *
   * Returns FINGERPRINTS (SHA-256 first 12 hex + length) of loaded secrets
   * and current JWKS cache state. Lets an operator compare:
   *   - hmac_fp here vs OpenXPKI's rendered RPC HMAC fp (must match)
   *   - jwks_kids here vs `curl auth.backend.id3a.cz/.../certs | jq .keys[].kid`
   *     (must intersect — pki-bridge must have the signing key the token was
   *      signed with)
   *
   * No raw secrets returned (fingerprints only), but M-D6 AUTH-GATES this route
   * (verifyToken): the config + JWKS/kid state + RPC HMAC fingerprint reveal the
   * mesh TLS trust posture and must not be enumerable by unauthenticated clients.
   */
  app.get('/diag', async (req: FastifyRequest) => {
    await verifyToken(req.headers.authorization);
    let jwksCache: Awaited<ReturnType<typeof getJwksCacheInfo>> = { kids: [], reachable: false, error: 'not-fetched' };
    try {
      jwksCache = await getJwksCacheInfo();
    } catch (err) {
      const e = err as Error;
      jwksCache = { kids: [], reachable: false, error: e.message };
    }
    const openxpki = await probeOpenxpkiRpc();
    return {
      service: 'svc-pki-bridge',
      config: {
        expected_issuer: config.expectedIssuer,
        expected_audience: config.jwtAudience,
        jwks_url: config.jwksUrl, // Internal — see /diag probes for both paths
        keycloak_public_url: config.keycloakUrl,
        keycloak_internal_url: config.keycloakInternalUrl,
        openxpki_rpc_url: config.openxpkiRpcUrl,
        openxpki_realm: config.openxpkiRealm,
        cert_profile: config.certProfile,
        key_algorithm: config.keyAlgorithm,
        allowed_san_patterns: config.allowedSanPatterns,
      },
      secrets_fp: {
        // pki-bridge ↔ OpenXPKI shared HMAC (compare with OpenXPKI's
        // /rendered/.../rpc-<realm>.yaml `hmac:` field)
        openxpki_rpc_hmac: fp(config.openxpkiRpcHmac),
      },
      jwks: jwksCache,
      openxpki: openxpki,
      runtime: {
        node_version: process.version,
        pid: process.pid,
        uptime_seconds: Math.floor(process.uptime()),
      },
    };
  });

  /**
   * /diag/openxpki-state — Track B (OpenXPKI 504) diagnostic endpoint.
   *
   * Reads the bootstrap log + checks for expected realm artifacts on the
   * shared `pki-config-rendered` volume (mounted ro at /etc/openxpki).
   * Lets the operator see WHAT pki-init's pki-realm-bootstrap.sh actually
   * did during the most recent deploy, without container shell access.
   *
   * No raw private keys — only paths, sizes, mtimes, and log tails. But those
   * tails include audit.log (the private-key + secret ACCESS log) plus
   * workflows.log/openxpki.log, so M-D6 AUTH-GATES this route (verifyToken):
   * the operational trace of the mesh TLS trust anchor is not for anon eyes.
   */
  app.get('/diag/openxpki-state', async (req: FastifyRequest) => {
    await verifyToken(req.headers.authorization);
    const root = '/etc/openxpki';
    // log4perl writes to /var/log/openxpki-server per openxpki-config/log.conf
    // (Logfile=openxpki.log, ApplicationFile=workflows.log, AuditFile=audit.log).
    // pki-server's volume mount + pki-bridge's :ro mount both target -server.
    const logRoot = '/var/log/openxpki-server';

    /**
     * Path safety guard for /diag/openxpki-state. Every fs operation in
     * this endpoint passes through here so the security invariant is
     * STRUCTURAL, not merely call-site-by-call-site. Any path that doesn't
     * resolve under one of the allowed roots is rejected — defends against
     * path-traversal even if a future call site sneaks user input in.
     */
    function assertUnderRoot(p: string): void {
      const okUnderConfig = p.startsWith(root + '/') || p === root;
      const okUnderLog = p.startsWith(logRoot + '/') || p === logRoot;
      if (!okUnderConfig && !okUnderLog) {
        throw new Error(`Refusing fs op outside ${root} or ${logRoot}: ${p}`);
      }
      if (p.includes('..')) {
        throw new Error(`Refusing fs op with traversal segment: ${p}`);
      }
    }

    function statSafe(p: string) {
      assertUnderRoot(p);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path guarded by assertUnderRoot
      if (!existsSync(p)) return { exists: false };
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- path guarded by assertUnderRoot
        const s = statSync(p);
        return {
          exists: true,
          size_bytes: s.size,
          mtime: s.mtime.toISOString(),
          is_dir: s.isDirectory(),
        };
      } catch (err) {
        return { exists: true, error: (err as Error).message };
      }
    }
    function listSafe(p: string, max = 50) {
      assertUnderRoot(p);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path guarded by assertUnderRoot
      if (!existsSync(p)) return [];
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- path guarded by assertUnderRoot
        return readdirSync(p).slice(0, max);
      } catch (err) {
        return [`(error: ${(err as Error).message})`];
      }
    }
    function readLogSafe(p: string, maxBytes = 50_000) {
      assertUnderRoot(p);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path guarded by assertUnderRoot
      if (!existsSync(p)) return null;
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- path guarded by assertUnderRoot
        const buf = readFileSync(p, 'utf8');
        return buf.length > maxBytes ? buf.slice(-maxBytes) : buf;
      } catch (err) {
        return `(error: ${(err as Error).message})`;
      }
    }

    // Anchors derived from pki-realm-bootstrap.sh's known output paths.
    const bootstrapLog = join(root, 'local/log/bootstrap-last.log');
    const keysDir = join(root, 'local/keys');
    const configDir = join(root, 'config.d');
    const realmsConfig = join(root, 'config.d/realm');
    // Rendered RPC policy — same file that controls auto-approve. Surface
    // approval_points + hmac fingerprint so operators can verify Track-B
    // fixes landed on the pki-server filesystem (vs. just in the git repo).
    // realm.tpl is used by every realm whose servername=generic.
    const rpcGeneric = join(root, 'config.d/realm.tpl/rpc/generic.yaml');

    return {
      volume_root: root,
      volume_readable: existsSync(root),
      bootstrap_log: {
        path: bootstrapLog,
        ...statSafe(bootstrapLog),
        tail: readLogSafe(bootstrapLog),
      },
      keys_dir: {
        path: keysDir,
        ...statSafe(keysDir),
        entries: listSafe(keysDir),
      },
      config_d: {
        path: configDir,
        ...statSafe(configDir),
        entries: listSafe(configDir),
      },
      realms: {
        path: realmsConfig,
        ...statSafe(realmsConfig),
        entries: listSafe(realmsConfig),
      },
      rpc_generic: {
        path: rpcGeneric,
        ...statSafe(rpcGeneric),
        content: readLogSafe(rpcGeneric),
      },
      // OpenXPKI server daemon logs — surfaces what the perl workflow engine
      // is doing during a hung /v1/issue call. log4perl appenders defined in
      // openxpki-config/log.conf:
      //   openxpki.log    — main daemon (Logfile appender, INFO/WARN/ERROR)
      //   workflows.log   — ApplicationFile (per-workflow trace via MDC wfid)
      //   audit.log       — AuditFile (private-key + secret access)
      // We tail each up to 50 KB. No raw private keys in the file appenders.
      server_log: {
        root: logRoot,
        root_exists: existsSync(logRoot),
        entries: listSafe(logRoot),
        openxpki: readLogSafe(join(logRoot, 'openxpki.log')),
        workflows: readLogSafe(join(logRoot, 'workflows.log')),
        audit: readLogSafe(join(logRoot, 'audit.log')),
      },
    };
  });
}
