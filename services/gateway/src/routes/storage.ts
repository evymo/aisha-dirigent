import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import httpProxy from '@fastify/http-proxy';
import { config } from '../config.js';

/**
 * /storage/v1/* → Storage Auth Microservice proxy
 *
 * All storage operations go through the Storage Auth service,
 * which handles JWT verification, RLS checks (via PostgREST RPCs),
 * and generates MinIO pre-signed URLs.
 */
export const storageProxy: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Outer plugin is registered with prefix '/storage/v1' in server.ts —
  // do NOT set it again here, Fastify would compound to '/storage/v1/storage/v1'.
  await app.register(httpProxy, {
    upstream: config.storageAuthUrl,
    rewritePrefix: '/',
    http2: false,
    proxyPayloads: true,
  });
};
