/**
 * Edge function / microservice invocation helper with Zod validation.
 *
 * Uses the pure API client — no @aisha/aisha-js dependency.
 *
 * @module
 */
import { z } from 'zod';
import { safeWarn } from '@/lib/security/safeLogger';
import { api } from './client';

export class EdgeFunctionInvokeError extends Error {
  readonly functionName: string;
  readonly kind = 'EdgeFunctionInvokeError';

  constructor(functionName: string, message = 'Edge function invocation failed') {
    super(message);
    this.name = 'EdgeFunctionInvokeError';
    this.functionName = functionName;
  }
}

type InvokeParams<TSchema extends z.ZodTypeAny | undefined> = {
  functionName: string;
  body: unknown;
  schema?: TSchema;
  context: string;
  /**
   * If true, allows calls without authentication.
   * The edge function will receive the request without Authorization header if user is not logged in.
   */
  allowAnonymous?: boolean;
};

/**
 * Invoke an edge function / Fastify microservice with optional Zod validation.
 *
 * @param params - Function name, body, optional Zod schema, context for logging.
 * @returns Parsed response data (typed by schema if provided).
 */
export async function invokeEdgeFunction<TSchema extends z.ZodTypeAny>(
  params: InvokeParams<TSchema>
): Promise<z.infer<TSchema>>;
export async function invokeEdgeFunction(
  params: InvokeParams<undefined>
): Promise<unknown>;
export async function invokeEdgeFunction<TSchema extends z.ZodTypeAny | undefined>(
  params: InvokeParams<TSchema>
): Promise<unknown> {
  const { functionName, body, schema, context } = params;

  const { data, error } = await api.invoke(functionName, {
    body: body as Record<string, unknown> | undefined,
  });

  if (error) {
    safeWarn('api.edge.invokeError', new Error(`${context}: ${functionName} failed`));
    throw new EdgeFunctionInvokeError(functionName);
  }

  if (!schema) return data;

  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    safeWarn('api.edge.invalidResponse', new Error(`${context}: ${functionName} invalid response`));
    throw new EdgeFunctionInvokeError(functionName, 'Edge function response invalid');
  }

  return parsed.data;
}

// ---------------------------------------------------------------------------
// Legacy overload — accepts aisha client as first arg for backward compat.
// Will be removed once all call sites are migrated.
// ---------------------------------------------------------------------------

/**
 * Legacy invokeEdgeFunction that accepts a client argument.
 * The client is IGNORED — api module handles auth internally.
 *
 * @deprecated Use `invokeEdgeFunction(params)` without client argument.
 */
export async function invokeEdgeFunctionLegacy<TSchema extends z.ZodTypeAny>(
  _client: unknown,
  params: InvokeParams<TSchema>
): Promise<z.infer<TSchema>>;
export async function invokeEdgeFunctionLegacy(
  _client: unknown,
  params: InvokeParams<undefined>
): Promise<unknown>;
export async function invokeEdgeFunctionLegacy<TSchema extends z.ZodTypeAny | undefined>(
  _client: unknown,
  params: InvokeParams<TSchema>
): Promise<unknown> {
  return invokeEdgeFunction(params as InvokeParams<z.ZodTypeAny>);
}

