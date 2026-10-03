import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { verifyToken } from '../auth.js';
import { issueCertificate, OpenXpkiRpcError } from '../openxpki-rpc.js';
import { config } from '../config.js';

// ── Request schema ──────────────────────────────────────────────────

// NB: hostname/SAN *syntactic* validity (RFC 1123 labels, no control bytes, no
// wildcard) is enforced at the SAN-policy boundary (matchesSanPolicy) so that a
// scope violation surfaces as 403 Forbidden rather than a generic 400. The
// schema only guards structural shape + DNS length limits here.
const IssueRequestSchema = z.object({
  /** Primary hostname for CN (e.g. "netbird.mesh.aisha.internal"). */
  hostname: z.string().min(1).max(253),
  /** Additional SANs. Hostname is always included as first SAN. */
  sans: z.array(z.string().min(1).max(253)).default([]),
  /** Human-readable comment for OpenXPKI audit trail. */
  comment: z.string().max(500).default('Issued by svc-pki-bridge'),
});

// ── SAN policy enforcement ──────────────────────────────────────────

/**
 * A single RFC 1123 DNS label: starts and ends with an alphanumeric, may
 * contain internal hyphens, 1–63 chars. Case-insensitive.
 *
 * This deliberately rejects "*", the empty string, and any label carrying
 * control bytes (CR/LF/NUL) or other characters outside the RFC 1123 set.
 */
const RFC1123_LABEL_CHARS = /^[a-z0-9-]+$/i;

/**
 * True iff `label` is a valid RFC 1123 DNS label: 1–63 chars, only
 * alphanumerics and internal hyphens, not starting/ending with a hyphen.
 * Implemented with a simple char-class test plus explicit boundary/length
 * checks (no ambiguous quantifier nesting) so it is provably linear-time
 * and cannot ReDoS on adversarial input.
 */
function isRfc1123Label(label: string): boolean {
  return (
    label.length >= 1 &&
    label.length <= 63 &&
    RFC1123_LABEL_CHARS.test(label) &&
    label[0] !== '-' &&
    label[label.length - 1] !== '-'
  );
}

/**
 * Top-level guard: a hostname/SAN is only ever eligible for policy matching
 * if it is a well-formed RFC 1123 hostname — i.e. a dot-separated sequence of
 * valid labels, with no empty labels (leading/trailing/double dots) and no
 * bytes outside the label set. This runs BEFORE any CSR is built, so control
 * bytes (\x00, \r, \n) and wildcards can never reach OpenXPKI.
 */
function isWellFormedHostname(hostname: string): boolean {
  if (hostname.length === 0 || hostname.length > 253) return false;
  return hostname.split('.').every(isRfc1123Label);
}

/**
 * Check if a hostname matches at least one allowed SAN pattern.
 *
 * Patterns use simple glob: `*.mesh.aisha.internal` matches any subdomain
 * of mesh.aisha.internal. No double-wildcard — single level only.
 *
 * This prevents a compromised token from issuing certs for arbitrary
 * domains. The scope is enforced at the bridge level, complementing
 * Keycloak's role-based access control.
 */
function matchesSanPolicy(hostname: string): boolean {
  // Reject anything that is not a syntactically valid RFC 1123 hostname first.
  // This closes the `!prefix.includes('.')` bypass that accepted a literal "*"
  // prefix, an empty leading label, and prefixes carrying CR/LF/NUL.
  if (!isWellFormedHostname(hostname)) return false;

  return config.allowedSanPatterns.some((pattern) => {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // ".mesh.aisha.internal"
      if (!hostname.endsWith(suffix)) return false;
      const prefix = hostname.slice(0, -suffix.length);
      // The variable prefix must be exactly one well-formed DNS label —
      // not "*", not empty, not multi-level.
      return isRfc1123Label(prefix);
    }
    return hostname === pattern;
  });
}

function validateAllSans(hostnames: string[]): string[] {
  const forbidden = hostnames.filter((h) => !matchesSanPolicy(h));
  return forbidden;
}

// ── Route handler ───────────────────────────────────────────────────

export async function issueRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/issue — Issue a TLS certificate via OpenXPKI.
   *
   * Auth: Bearer JWT with aud=pki-proxy (Keycloak ROPC from aisha-pki-bootstrap).
   * Body: { hostname: string, sans?: string[], comment?: string }
   * Response: { certificate, privateKey, chain, certIdentifier, transactionId }
   *
   * The bridge:
   *   1. Validates JWT (audience, issuer, expiry)
   *   2. Checks all requested SANs against allowed patterns
   *   3. Generates EC P-384 key + PKCS#10 CSR
   *   4. Submits to OpenXPKI RPC with HMAC auth → auto-approved
   *   5. Returns PEM bundle
   */
  app.post('/v1/issue', async (req: FastifyRequest, reply: FastifyReply) => {
    // ── Auth ──
    const caller = await verifyToken(req.headers.authorization);
    req.log.info({ sub: caller.sub, clientId: caller.clientId }, 'Authenticated cert issuance request');

    // ── Parse + validate body ──
    const parseResult = IssueRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid request body',
        details: parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }

    const { hostname, sans, comment } = parseResult.data;
    const allSans = [hostname, ...sans.filter((s) => s !== hostname)];

    // ── SAN policy check ──
    const forbidden = validateAllSans(allSans);
    if (forbidden.length > 0) {
      req.log.warn({ forbidden, clientId: caller.clientId }, 'SAN policy violation');
      return reply.status(403).send({
        error: 'Forbidden: requested SAN(s) not in allowed patterns',
        forbidden,
        allowedPatterns: config.allowedSanPatterns,
      });
    }

    // ── Issue cert ──
    const auditComment = `${comment} | caller=${caller.clientId} sub=${caller.sub}`;
    let cert;
    try {
      cert = await issueCertificate(hostname, allSans, auditComment);
    } catch (error: unknown) {
      if (error instanceof OpenXpkiRpcError) {
        req.log.error({ hostname, err: error.message }, 'OpenXPKI certificate issuance failed');
        return reply.status(error.statusCode).send({
          error: 'PKI backend issuance failed',
          detail: error.message,
        });
      }

      throw error;
    }

    req.log.info({
      hostname,
      certIdentifier: cert.certIdentifier,
      transactionId: cert.transactionId,
    }, 'Certificate issued successfully');

    return reply.status(201).send(cert);
  });
}
