import { createHmac, generateKeyPairSync, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { config } from './config.js';

/* eslint-disable security/detect-non-literal-fs-filename -- all fs ops target a per-call tmpdir (os.tmpdir()+randomUUID) and its fixed children key.pem/csr.pem/openssl.cnf; CN/SANs go into file CONTENT, never the path; key written 0o600, cleaned in finally */

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export interface IssuedCertificate {
  /** PEM-encoded issued certificate. */
  certificate: string;
  /** PEM-encoded private key corresponding to the CSR. */
  privateKey: string;
  /** PEM-encoded CA chain (intermediate + root). */
  chain: string;
  /** OpenXPKI cert_identifier (opaque tracking ID). */
  certIdentifier: string;
  /** OpenXPKI transaction_id. */
  transactionId: string;
}

interface RpcResponse {
  result?: {
    data?: Record<string, unknown>;
    state?: string;
    id?: number;
  };
  error?: {
    message?: string;
    code?: number;
  };
}

export class OpenXpkiRpcError extends Error {
  readonly statusCode = 502;

  constructor(message: string) {
    super(message);
    this.name = 'OpenXpkiRpcError';
  }
}

// ─────────────────────────────────────────────────────────────────────
// CSR generation (PKCS#10) — uses openssl CLI via execFileSync
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a PKCS#10 CSR with CN and SAN extension using openssl.
 *
 * Uses `execFileSync` (no shell interpolation → no injection risk).
 * openssl is available in every container image we use (Alpine/Debian).
 * This avoids pulling in ~500KB of native X.509 JS libraries for a
 * single operation that runs at most once every few weeks.
 *
 * Returns { csr: PEM, privateKey: PEM }.
 */
export function generateCsrAndKey(cn: string, sans: string[]): { csr: string; privateKey: string } {
  const namedCurve = config.keyAlgorithm === 'P-256' ? 'prime256v1'
    : config.keyAlgorithm === 'P-521' ? 'secp521r1'
    : 'secp384r1'; // P-384 default

  const { privateKey } = generateKeyPairSync('ec', {
    namedCurve,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const workDir = join(tmpdir(), `pki-bridge-${randomUUID()}`);
  mkdirSync(workDir, { recursive: true });

  const keyPath = join(workDir, 'key.pem');
  const csrPath = join(workDir, 'csr.pem');
  const cnfPath = join(workDir, 'openssl.cnf');

  try {
    writeFileSync(keyPath, privateKey, { mode: 0o600 });

    // Build OpenSSL config with SAN extension
    const sanEntries = sans.map((s, i) => `DNS.${i + 1} = ${s}`).join('\n');
    const cnfContent = [
      '[req]',
      'distinguished_name = req_dn',
      'req_extensions = v3_req',
      'prompt = no',
      '',
      '[req_dn]',
      `CN = ${cn}`,
      '',
      '[v3_req]',
      'subjectAltName = @alt_names',
      'keyUsage = critical, digitalSignature, keyEncipherment',
      'extendedKeyUsage = serverAuth',
      '',
      '[alt_names]',
      sanEntries,
    ].join('\n');

    writeFileSync(cnfPath, cnfContent);

    // execFileSync — no shell, arguments passed as array → safe from injection
    execFileSync('openssl', [
      'req', '-new',
      '-key', keyPath,
      '-out', csrPath,
      '-config', cnfPath,
      '-sha384',
    ], { timeout: 10_000, stdio: 'pipe' });

    return { csr: readFileSync(csrPath, 'utf8'), privateKey };
  } finally {
    try { unlinkSync(keyPath); } catch { /* ignore */ }
    try { unlinkSync(csrPath); } catch { /* ignore */ }
    try { unlinkSync(cnfPath); } catch { /* ignore */ }
    try { rmdirSync(workDir); } catch { /* ignore */ }
  }
}

// ─────────────────────────────────────────────────────────────────────
// HMAC calculation for OpenXPKI RPC authentication
// ─────────────────────────────────────────────────────────────────────

/**
 * Calculate HMAC for OpenXPKI RPC authentication.
 *
 * OpenXPKI's HMAC validation hashes the DER payload of the PKCS#10
 * request with the shared secret. The `signature` field in the RPC
 * request carries this value. When it matches, the request gets 1
 * approval point → auto-approved if approval_points=1.
 *
 * See: OpenXPKI::Server::Workflow::Activity::Tools::CalculateRequestHMAC
 */
export function calculateHmac(csrPem: string, secret: string): string {
  const csrDer = decodeCsrPemToDer(csrPem);
  return createHmac('sha256', secret).update(csrDer).digest('hex');
}

function decodeCsrPemToDer(csrPem: string): Buffer {
  const match = csrPem.match(
    /-----BEGIN (?:NEW )?CERTIFICATE REQUEST-----([\s\S]+?)-----END (?:NEW )?CERTIFICATE REQUEST-----/,
  );

  if (!match) {
    throw new Error('PKCS#10 CSR PEM block is missing');
  }

  const base64 = match[1].replace(/\s+/g, '');
  if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) {
    throw new Error('PKCS#10 CSR PEM block is not valid base64');
  }

  const der = Buffer.from(base64, 'base64');
  if (der.length === 0) {
    throw new Error('PKCS#10 CSR DER payload is empty');
  }

  return der;
}

// ─────────────────────────────────────────────────────────────────────
// OpenXPKI RPC client
// ─────────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseRpcResponse(raw: unknown): RpcResponse {
  if (!isRecord(raw)) throw new OpenXpkiRpcError('OpenXPKI RPC returned non-object response');
  return raw as RpcResponse;
}

async function postRpcRequest(rpcUrl: string, body: string): Promise<Response> {
  try {
    // 30s upper bound — auto-approved certificate enrollment normally
    // completes in <5s on a warm OpenXPKI. Anything longer indicates the
    // workflow is hung (waiting for manual approval, missing realm artifact,
    // pool exhausted). Failing fast surfaces the real error to /v1/issue
    // callers (e.g. pki-init) instead of letting Traefik 504 at 60s.
    return await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(30000),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new OpenXpkiRpcError(`OpenXPKI RPC endpoint unreachable: ${message}`);
  }
}

async function parseRpcJson(res: Response): Promise<RpcResponse> {
  try {
    return parseRpcResponse(await res.json());
  } catch (error: unknown) {
    if (error instanceof OpenXpkiRpcError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new OpenXpkiRpcError(`OpenXPKI RPC returned invalid JSON: ${message}`);
  }
}

/**
 * Submit a CSR to OpenXPKI via the JSON-RPC endpoint.
 *
 * Endpoint: POST /rpc/<realm>/RequestCertificate
 * Auth: HMAC signature in the `signature` field
 * Input: pkcs10 (PEM CSR), profile (cert template), signature (HMAC)
 * Output: cert_identifier, certificate (PEM), chain (PEM), transaction_id
 *
 * If the response state is PENDING, we poll with the transaction_id
 * until the cert is issued (max ~30s for auto-approved requests).
 */
export async function requestCertificate(
  csrPem: string,
  profile: string,
  comment: string,
): Promise<{ certificate: string; chain: string; certIdentifier: string; transactionId: string }> {
  const hmacSecret = config.openxpkiRpcHmac;
  if (!hmacSecret) {
    throw new OpenXpkiRpcError('OPENXPKI_RPC_HMAC is required');
  }

  const signature = calculateHmac(csrPem, hmacSecret);
  const rpcUrl = `${config.openxpkiRpcUrl}/${config.openxpkiRealm}/RequestCertificate`;

  const body = JSON.stringify({
    method: 'RequestCertificate',
    pkcs10: csrPem,
    profile,
    signature,
    comment,
  });

  const res = await postRpcRequest(rpcUrl, body);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new OpenXpkiRpcError(`OpenXPKI RPC RequestCertificate failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
  }

  const rpc = await parseRpcJson(res);

  if (rpc.error) {
    throw new OpenXpkiRpcError(`OpenXPKI RPC error: ${rpc.error.message ?? 'unknown'} (code=${rpc.error.code ?? '?'})`);
  }

  const data = rpc.result?.data;
  if (!data) {
    throw new OpenXpkiRpcError('OpenXPKI RPC returned no result data');
  }

  // If auto-approved, cert is returned immediately
  const certificate = typeof data.certificate === 'string' ? data.certificate : '';
  const chain = typeof data.chain === 'string' ? data.chain : '';
  const certIdentifier = typeof data.cert_identifier === 'string' ? data.cert_identifier : '';
  const transactionId = typeof data.transaction_id === 'string' ? data.transaction_id : '';

  if (certificate) {
    return { certificate, chain, certIdentifier, transactionId };
  }

  // If state is PENDING or cert not yet available, poll via pickup
  if (transactionId) {
    return pollForCertificate(transactionId);
  }

  throw new OpenXpkiRpcError(`OpenXPKI RPC: no certificate and no transaction_id (state=${rpc.result?.state ?? '?'})`);
}

/**
 * Poll OpenXPKI for a pending cert via transaction_id.
 * Max 10 attempts x 3s = 30s. Auto-approved certs usually resolve in <5s.
 */
async function pollForCertificate(
  transactionId: string,
  maxAttempts = 10,
  intervalMs = 3000,
): Promise<{ certificate: string; chain: string; certIdentifier: string; transactionId: string }> {
  const rpcUrl = `${config.openxpkiRpcUrl}/${config.openxpkiRealm}/RequestCertificate`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, intervalMs));

    const res = await postRpcRequest(rpcUrl, JSON.stringify({
      method: 'RequestCertificate',
      transaction_id: transactionId,
    }));

    if (!res.ok) continue;

    const rpc = await parseRpcJson(res);
    const data = rpc.result?.data;
    if (!data) continue;

    const certificate = typeof data.certificate === 'string' ? data.certificate : '';
    if (certificate) {
      return {
        certificate,
        chain: typeof data.chain === 'string' ? data.chain : '',
        certIdentifier: typeof data.cert_identifier === 'string' ? data.cert_identifier : '',
        transactionId,
      };
    }
  }

  throw new OpenXpkiRpcError(`OpenXPKI cert issuance timed out after ${maxAttempts} polls for txn=${transactionId}`);
}

/**
 * Full issuance flow: generate key + CSR -> submit to OpenXPKI -> return bundle.
 *
 * This is the main entry point called by the /v1/issue route handler.
 */
export async function issueCertificate(
  hostname: string,
  sans: string[],
  comment: string,
): Promise<IssuedCertificate> {
  const { csr, privateKey } = generateCsrAndKey(hostname, sans);
  const result = await requestCertificate(csr, config.certProfile, comment);

  return {
    certificate: result.certificate,
    privateKey,
    chain: result.chain,
    certIdentifier: result.certIdentifier,
    transactionId: result.transactionId,
  };
}
