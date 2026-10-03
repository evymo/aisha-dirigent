/**
 * API integration barrel export.
 *
 * Provides the complete client API for frontend data access:
 * - `api` — PostgREST RPC + microservice invoke
 * - `storage` — MinIO file operations via Storage Auth
 * - `realtime` — WebSocket subscriptions via WS Gateway
 * - `invokeEdgeFunction` — Typed microservice calls with Zod validation
 *
 * @module
 */
export { api, gatewayUrl, isUsingDevFallback, createApiClient } from './client';
export type { ApiResponse, ApiError, InvokeOptions, ApiClient } from './client';

export { storage } from './storage';
export type {
  StorageUploadResult,
  StorageDeleteResult,
  StorageSignedUrlResult,
  StorageUploadOptions,
} from './storage';

export { realtime, RealtimeChannel } from './realtime';
export type { PostgresChangePayload, ChangeFilter } from './realtime';

export { invokeEdgeFunction, invokeEdgeFunctionLegacy, EdgeFunctionInvokeError } from './edge';
