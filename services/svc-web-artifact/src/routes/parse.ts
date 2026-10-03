/**
 * POST /parse — main ingest worker.
 *
 * Input: { job_id, source_type, source_storage_path|source_url }.
 * Steps:
 *   1. mark_web_artifact_processing
 *   2. fetch source (zip from storage, or scrape URL)
 *   3. extract HTML + CSS
 *   4. htmlToProjectData (jsdom + DOMPurify + token extract + detector + i18n keys)
 *   5. complete_web_artifact_ingest with parsed result
 *
 * On any error: fail_web_artifact_ingest with diagnostic message.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createSafeLogger } from '@aisha/security';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { IngestRequestSchema } from '../schemas.js';
import { rpcClient } from '../lib/rpcClient.js';
import { extractZip, pickPrimaryHtml, concatCss, ZipExtractError } from '../lib/zipExtractor.js';
import { htmlToProjectData } from '../lib/htmlToProjectData.js';
import { config } from '../config.js';
import { verifyServiceRole, AuthError } from '../auth.js';

const log = createSafeLogger('svc-web-artifact/parse');

// ─── URL scraper (inline because the original lib/urlScraper.js never
// landed in commit 0165829e — kept in this file to avoid adding a new
// repo file purely for a single call site) ───────────────────────────
// SSRF guard: HTTP(S)-only, private-host/IP blocked, 15s timeout, 5 MB cap.
// Defense-in-depth on top of the gateway's safeFetch wrapper.

export class ScrapeError extends Error {
  constructor(message: string, public code: 'INVALID_URL' | 'BLOCKED_HOST' | 'FETCH_FAILED') {
    super(message);
    this.name = 'ScrapeError';
  }
}

const SCRAPE_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_CSS_LINKS = 20;
const MAX_REDIRECTS = 5;
const PRIVATE_HOST_RE = /^(localhost|127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.|::1$|fc[0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function normaliseHostname(hostname: string): string {
  return hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

function isBlockedIp(ip: string): boolean {
  if (!ip) return true;
  if (ip.includes(':')) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1' || lower.startsWith('fe80:')) return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    return false;
  }

  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 127) return true;
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 224 || a >= 240) return true;
  return false;
}

export function assertPublicHttpUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ScrapeError(`invalid URL: ${rawUrl}`, 'INVALID_URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ScrapeError(`scheme ${parsed.protocol} not allowed`, 'INVALID_URL');
  }
  const hostname = normaliseHostname(parsed.hostname);
  if (PRIVATE_HOST_RE.test(hostname)) {
    throw new ScrapeError(`private host blocked: ${hostname}`, 'BLOCKED_HOST');
  }
  return parsed;
}

async function assertPublicResolvedHost(target: URL): Promise<void> {
  const hostname = normaliseHostname(target.hostname);
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new ScrapeError(`private IP blocked: ${hostname}`, 'BLOCKED_HOST');
    }
    return;
  }

  let address: string;
  try {
    ({ address } = await lookup(hostname, { verbatim: true }));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ScrapeError(`host resolution failed for ${hostname}: ${reason}`, 'FETCH_FAILED');
  }
  if (isBlockedIp(address)) {
    throw new ScrapeError(`host resolves to private IP: ${hostname} -> ${address}`, 'BLOCKED_HOST');
  }
}

export async function fetchTextSafe(target: URL, redirectsRemaining = MAX_REDIRECTS): Promise<string> {
  const safeTarget = assertPublicHttpUrl(target.toString());
  await assertPublicResolvedHost(safeTarget);
  const res = await fetch(safeTarget.toString(), {
    redirect: 'manual',
    signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
    headers: { 'User-Agent': 'AISHA-svc-web-artifact/0.1 (+url_scrape)' },
  });

  if (REDIRECT_STATUSES.has(res.status)) {
    if (redirectsRemaining <= 0) {
      throw new ScrapeError(`too many redirects from ${safeTarget}`, 'FETCH_FAILED');
    }
    const location = res.headers.get('location');
    if (!location) {
      throw new ScrapeError(`redirect without Location from ${safeTarget}`, 'FETCH_FAILED');
    }
    return fetchTextSafe(new URL(location, safeTarget), redirectsRemaining - 1);
  }

  if (!res.ok) throw new ScrapeError(`HTTP ${res.status} on ${target}`, 'FETCH_FAILED');
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_HTML_BYTES) {
    throw new ScrapeError(`response too large (${buf.byteLength} > ${MAX_HTML_BYTES})`, 'FETCH_FAILED');
  }
  return new TextDecoder('utf-8').decode(buf);
}

async function scrapeUrl(rawUrl: string): Promise<{ html: string; css: string; baseUrl: string }> {
  const parsed = assertPublicHttpUrl(rawUrl);
  const html = await fetchTextSafe(parsed);
  // Inline `<style>` blocks
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  const inline: string[] = [];
  for (const m of html.matchAll(styleRe)) inline.push(m[1]);
  // Linked stylesheets
  const linkRe = /<link\b[^>]*\brel\s*=\s*["']?stylesheet["']?[^>]*>/gi;
  const hrefRe = /\bhref\s*=\s*["']([^"']+)["']/i;
  const linkHrefs: string[] = [];
  for (const m of html.matchAll(linkRe)) {
    const h = m[0].match(hrefRe);
    if (h) linkHrefs.push(h[1]);
  }
  const cssChunks: string[] = inline.length ? [inline.join('\n\n')] : [];
  for (const href of linkHrefs.slice(0, MAX_CSS_LINKS)) {
    try {
      cssChunks.push(await fetchTextSafe(new URL(href, parsed)));
    } catch (err) {
      // Stylesheet fetch failures are non-fatal — primary HTML is the
      // source of truth; missing CSS just means the design import lacks
      // styling. Log so operators see what didn't make it.
      log.safeWarn('scrapeUrl.css_link_skipped', {
        href,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { html, css: cssChunks.join('\n\n'), baseUrl: parsed.toString() };
}

export async function parseRoutes(app: FastifyInstance): Promise<void> {
  app.post('/parse', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch (err) {
      if (err instanceof AuthError) {
        reply.code(err.statusCode);
        return { error: err.message };
      }
      reply.code(401);
      return { error: 'Unauthorized' };
    }
    const parsed = IngestRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_request', issues: parsed.error.issues };
    }
    const { job_id, source_type, source_storage_path, source_url } = parsed.data;

    try {
      await rpcClient.markProcessing(job_id);
    } catch (err) {
      reply.code(409);
      return { error: 'job_not_pending', detail: (err as Error).message };
    }

    try {
      let html = '';
      let css = '';
      const metadata: Record<string, unknown> = {};

      if (source_type === 'folder_upload') {
        if (!source_storage_path) throw new Error('source_storage_path required for folder_upload');
        const zipBytes = await rpcClient.downloadStorageObject(source_storage_path);
        const files = extractZip(zipBytes, {
          maxEntries: config.maxZipEntries,
          maxUncompressedBytes: config.maxZipUncompressedBytes,
        });
        const primary = pickPrimaryHtml(files);
        if (!primary) throw new Error('no .html file found in archive');
        html = primary.bytes.toString('utf-8');
        css = concatCss(files);
        metadata.source_files_count = files.length;
        metadata.primary_html_path = primary.path;
      } else if (source_type === 'url_scrape') {
        if (!source_url) throw new Error('source_url required for url_scrape');
        const fetched = await scrapeUrl(source_url);
        html = fetched.html;
        css = fetched.css;
        metadata.scraped_base_url = fetched.baseUrl;
      } else {
        throw new Error(`source_type ${source_type} not handled by /parse (use /seed-default for default_seed)`);
      }

      const result = htmlToProjectData({ html, css });
      metadata.runtime_block_suggestions = result.runtime_block_suggestions;
      metadata.i18n_keys_used = result.i18n_keys_used;
      metadata.broken_assets = result.broken_assets;

      await rpcClient.complete({
        jobId: job_id,
        canvasData: result.canvas_data,
        canvasHtml: result.canvas_html,
        canvasCss: result.canvas_css,
        extractedTokens: result.extracted_tokens,
        metadata,
      });

      return { ok: true, job_id };
    } catch (err) {
      const error = err as Error;
      const code = err instanceof ZipExtractError ? err.code
        : err instanceof ScrapeError ? err.code
        : 'parse_failed';
      try {
        await rpcClient.fail(job_id, `${code}: ${error.message}`);
      } catch {
        // swallow — primary error wins
      }
      reply.code(422);
      return { error: code, detail: error.message };
    }
  });
}
