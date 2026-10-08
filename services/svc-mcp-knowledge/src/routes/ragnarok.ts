import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken, verifyServiceRole, isAdminOrStaff, AuthError } from '../auth.js';
import { config } from '../config.js';
import { detectSourceType } from '../lib/file-type.js';
import { skenujNahravku } from '../lib/av-nahravka.js';

const DEFAULT_LANG = 'cs-CZ';

type RagnarokKbRow = {
  kb_id: string;
  project_id: string;
  document_count?: number;
  created_at?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeKbList(payload: unknown, projectId: string): RagnarokKbRow[] {
  const rows = isRecord(payload) && Array.isArray(payload.data)
    ? payload.data
    : isRecord(payload) && Array.isArray(payload.knowledge_bases)
      ? payload.knowledge_bases
      : Array.isArray(payload)
        ? payload
        : [];

  return rows.flatMap((row): RagnarokKbRow[] => {
    if (typeof row === 'string' && row.length > 0) {
      return [{ kb_id: row, project_id: projectId }];
    }
    if (!isRecord(row)) return [];

    const kbId = optionalString(row.kb_id) ?? optionalString(row.id) ?? optionalString(row._id);
    if (!kbId) return [];

    const normalized: RagnarokKbRow = {
      kb_id: kbId,
      project_id: optionalString(row.project_id) ?? projectId,
    };
    const documentCount = optionalNumber(row.document_count) ?? optionalNumber(row.total_pages);
    if (documentCount !== undefined) normalized.document_count = documentCount;
    const createdAt = optionalString(row.created_at);
    if (createdAt !== undefined) normalized.created_at = createdAt;

    return [normalized];
  });
}

async function readJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function extractErrorDetail(payload: unknown): string {
  return isRecord(payload)
    ? optionalString(payload.detail) ?? optionalString(payload.error) ?? ''
    : typeof payload === 'string'
      ? payload
      : '';
}

function isEmptyKbListNotFound(payload: unknown): boolean {
  const detail = extractErrorDetail(payload);
  return detail.includes('Data record') && detail.includes('not found');
}

/**
 * Ragnarok's `GET /knowledge_base/` 500s on a fresh/empty Elasticsearch:
 * with zero `{index}_*` indices ES omits the `aggregations` key from the
 * search response, and upstream `VectorStore.get_kb_ids`
 * (packages/insight/ragnarok/ragnarok/vector_db.py — git submodule, not
 * patchable from this repo) reads `res["aggregations"]` unguarded →
 * KeyError('aggregations') → FastAPI detail
 * "Unhandled exception occurred: 'aggregations'". Its sibling
 * `get_project_ids` guards exactly this case and returns [] — an empty store
 * simply has zero knowledge bases. This predicate matches ONLY that one
 * upstream signature so the proxy can answer with a correct-empty list;
 * every other 500 (genuine ES failure, auth, timeout, …) stays a loud 502.
 */
function isEmptyEsAggregationsError(payload: unknown): boolean {
  const detail = extractErrorDetail(payload);
  return detail.includes('Unhandled exception occurred') && detail.includes("'aggregations'");
}

/**
 * POST /ragnarok/search — Hybrid RAG search via Ragnarok engine.
 * Authenticated user or service-role.
 */
export async function ragnarokRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: {
      query: string;
      project_id?: string;
      kb_ids?: string[];
      lang?: string;
      context?: Array<{ role: string; content: string }>;
      stream?: boolean;
      return_highlights?: boolean;
      return_matched_chunks?: boolean;
      settings?: Record<string, unknown>;
    };
  }>('/ragnarok/search', async (req, reply) => {
    // Auth: KC JWT or service-role
    let isServiceRole = false;
    try {
      verifyServiceRole(req.headers.authorization);
      isServiceRole = true;
    } catch {
      try {
        await verifyToken(req.headers.authorization);
      } catch (err) {
        const status = err instanceof AuthError ? err.statusCode : 401;
        return reply.code(status).send({ error: 'Not authenticated' });
      }
    }

    const { query, project_id, kb_ids, lang, context, stream, return_highlights, return_matched_chunks, settings } = req.body ?? {};

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return reply.code(400).send({ error: 'query is required' });
    }
    if (query.length > 10_000) {
      return reply.code(400).send({ error: 'query exceeds maximum length' });
    }

    const projectId = project_id ?? config.ragnarokDefaultProjectId;
    const ragnarokBody: Record<string, unknown> = {
      query: query.trim(),
      lang: lang ?? DEFAULT_LANG,
      return_highlights: return_highlights ?? false,
      return_matched_chunks: return_matched_chunks ?? false,
    };
    if (kb_ids?.length) ragnarokBody.kb_ids = kb_ids;
    if (context?.length) ragnarokBody.context = context;
    if (settings) ragnarokBody.settings = settings;

    const endpoint = stream
      ? `${config.ragnarokUrl}/projects/${encodeURIComponent(projectId)}/nlp/rag/stream`
      : `${config.ragnarokUrl}/projects/${encodeURIComponent(projectId)}/nlp/rag/`;

    try {
      const ragRes = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': config.ragnarokApiKey,
        },
        body: JSON.stringify(ragnarokBody),
        signal: AbortSignal.timeout(60_000),
      });

      if (!ragRes.ok) {
        const errText = await ragRes.text().catch(() => '(empty)');
        req.log.error({ status: ragRes.status, errText: errText.slice(0, 500) }, 'Ragnarok API error');
        return reply.code(502).send({ error: 'RAG search failed', status: ragRes.status });
      }

      if (stream && ragRes.body) {
        reply
          .header('Content-Type', 'application/x-ndjson')
          .header('Transfer-Encoding', 'chunked');
        // Pipe readable stream
        const reader = ragRes.body.getReader();
        const writable = reply.raw;
        reply.raw.writeHead(200, {
          'Content-Type': 'application/x-ndjson',
          'Transfer-Encoding': 'chunked',
        });
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) { writable.end(); break; }
            writable.write(value);
          }
        };
        pump().catch(() => writable.end());
        return;
      }

      const data = await ragRes.json();
      return reply.send({ ok: true, data });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        return reply.code(504).send({ error: 'Ragnarok request timed out' });
      }
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: 'RAG service unavailable' });
    }
  });

  /** POST /ragnarok/upload — Upload docs to Ragnarok KB (admin/staff). */
  app.post('/ragnarok/upload', async (req, reply) => {
    let user;
    try {
      user = await verifyToken(req.headers.authorization);
    } catch {
      try {
        verifyServiceRole(req.headers.authorization);
      } catch {
        return reply.code(401).send({ error: 'Not authenticated' });
      }
    }

    if (user && !isAdminOrStaff(user)) {
      return reply.code(403).send({ error: 'Insufficient permissions — admin or staff required' });
    }

    const contentType = req.headers['content-type'] ?? '';

    if (contentType.includes('multipart/form-data')) {
      // Multipart upload
      const parts = await (req as unknown as { file: () => Promise<{ file: NodeJS.ReadableStream; filename: string; fields: Record<string, { value: string }> }> }).file();
      if (!parts) {
        return reply.code(400).send({ error: 'file is required' });
      }

      const projectId = parts.fields.project_id?.value ?? config.ragnarokDefaultProjectId;
      const url = new URL(`${config.ragnarokUrl}/knowledge_base/file`);
      url.searchParams.set('project_id', projectId);
      if (parts.fields.kb_id?.value) url.searchParams.set('kb_id', parts.fields.kb_id.value);
      if (parts.fields.language?.value) url.searchParams.set('language', parts.fields.language.value);

      // Collect file buffer for forwarding
      const chunks: Buffer[] = [];
      for await (const chunk of parts.file) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as Uint8Array));
      }
      const fileBuffer = Buffer.concat(chunks);

      // Antivir PŘED předáním enginu (lib/av-nahravka.ts). Dál smí jen `clean`;
      // nález i neprovedený sken nahrání odmítnou — engine soubor vůbec neuvidí.
      const verdikt = await skenujNahravku(fileBuffer);
      if (verdikt.status === 'infected') {
        req.log.warn({ signature: verdikt.signature, size: fileBuffer.length }, 'kb upload: malware detected — refused');
        return reply.code(422).send({
          error: 'File rejected: malware detected',
          code: 'av_infected',
          signature: verdikt.signature,
        });
      }
      if (verdikt.status === 'disabled') {
        req.log.error('kb upload: antivirus scan is switched OFF (AV_SCAN_ENABLED=false) in production — refused');
        return reply.code(503).send({
          error: 'Upload refused: antivirus scan is switched off',
          code: 'av_disabled',
        });
      }
      if (verdikt.status === 'error' && verdikt.kind === 'size_limit') {
        // Vada SOUBORU, ne platformy: správce nemá hledat výpadek antiviru.
        req.log.warn({ size: fileBuffer.length }, 'kb upload: file exceeds the antivirus stream limit — refused');
        return reply.code(413).send({
          error: 'File rejected: too large for the antivirus scan',
          code: 'av_too_large',
        });
      }
      if (verdikt.status === 'error') {
        req.log.error({ reason: verdikt.reason, size: fileBuffer.length }, 'kb upload: antivirus scan did not complete — refused');
        return reply.code(503).send({
          error: 'Upload refused: antivirus scan is unavailable',
          code: 'av_unavailable',
        });
      }
      if (verdikt.status === 'skipped') {
        req.log.warn('kb upload: antivirus scan is switched OFF (AV_SCAN_ENABLED=false) — file forwarded unscanned');
      }

      // Detect source_type at the gateway: clients upload raw files, we map
      // them to Ragnarok's enum (pdf|txt|docx|html|pptx|xlsx). Klient může
      // override přes `source_type` form field; jinak filename extension +
      // magic bytes nás dovedou ke správnému typu. Bez tohohle Ragnarok
      // upstream defaultuje PDF a parser pak failne na non-PDF content.
      const sourceType = detectSourceType({
        filename: parts.filename,
        buffer: fileBuffer.subarray(0, 64),
        provided: parts.fields.source_type?.value,
      });
      url.searchParams.set('source_type', sourceType);

      const blob = new Blob([new Uint8Array(fileBuffer)]);
      const formData = new FormData();
      formData.append('file', blob, parts.filename);

      const ragRes = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Authorization': config.ragnarokApiKey },
        body: formData,
        signal: AbortSignal.timeout(120_000),
      });

      if (!ragRes.ok) {
        return reply.code(502).send({ error: `Ragnarok upload failed: ${ragRes.status}` });
      }

      const data = await ragRes.json();
      return reply.code(201).send({ ok: true, data });
    }

    // JSON: list or delete
    const body = req.body as Record<string, unknown>;
    const action = body?.action;
    const projectId = typeof body?.project_id === 'string' ? body.project_id : config.ragnarokDefaultProjectId;

    if (action === 'list') {
      const url = new URL(`${config.ragnarokUrl}/knowledge_base/`);
      url.searchParams.set('project_id', projectId);
      const ragRes = await fetch(url.toString(), {
        headers: { 'Authorization': config.ragnarokApiKey },
        signal: AbortSignal.timeout(15_000),
      });
      if (ragRes.status === 404) {
        const errorPayload = await readJsonSafe(ragRes);
        if (!isEmptyKbListNotFound(errorPayload)) {
          return reply.code(502).send({ error: `Ragnarok list failed: ${ragRes.status}` });
        }
        return reply.send({ ok: true, data: [], knowledge_bases: [] });
      }
      if (ragRes.status === 500) {
        // Empty ES (no indices yet) is a correct-empty KB list, not a failure —
        // see isEmptyEsAggregationsError. Any other 500 surfaces loudly below.
        const errorPayload = await readJsonSafe(ragRes);
        if (isEmptyEsAggregationsError(errorPayload)) {
          return reply.send({ ok: true, data: [], knowledge_bases: [] });
        }
        req.log.error(
          { status: ragRes.status, detail: extractErrorDetail(errorPayload).slice(0, 500) },
          'Ragnarok KB list failed',
        );
        return reply.code(502).send({ error: `Ragnarok list failed: ${ragRes.status}` });
      }
      if (!ragRes.ok) return reply.code(502).send({ error: `Ragnarok list failed: ${ragRes.status}` });
      const data: unknown = await readJsonSafe(ragRes);
      return reply.send({ ok: true, data, knowledge_bases: normalizeKbList(data, projectId) });
    }

    if (action === 'delete') {
      const kbId = body?.kb_id;
      if (typeof kbId !== 'string') return reply.code(400).send({ error: 'kb_id required for delete' });
      const url = new URL(`${config.ragnarokUrl}/knowledge_base/${encodeURIComponent(kbId)}/`);
      url.searchParams.set('project_id', projectId);
      const ragRes = await fetch(url.toString(), {
        method: 'DELETE',
        headers: { 'Authorization': config.ragnarokApiKey },
        signal: AbortSignal.timeout(15_000),
      });
      if (!ragRes.ok) return reply.code(502).send({ error: `Ragnarok delete failed: ${ragRes.status}` });
      return reply.send({ ok: true, deleted: kbId });
    }

    return reply.code(400).send({ error: 'Unknown action' });
  });
}
