// Runtime configuration for edge functions

const isTruthyBoolean = (value: unknown) => value === true || value === 'true';

const readNonEmptyString = (value: string | undefined | null): string | undefined => {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const readNonNegativeInt = (raw: string | undefined | null, fallback: number): number => {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) return fallback;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

type EdgeRuntimeMode = 'production' | 'development';

const inferModeFromSupabaseUrl = (rawUrl: string | undefined): EdgeRuntimeMode => {
  if (!rawUrl) return 'production';

  try {
    const parsed = new URL(rawUrl);
    const hostname = (parsed.hostname ?? '').toLowerCase();

    // Local Supabase defaults to localhost/127.0.0.1.
    if (hostname === 'localhost' || hostname === '0.0.0.0' || hostname.startsWith('127.')) {
      return 'development';
    }
  } catch {
    // Ignore invalid URLs; treat as production (safe default).
  }

  return 'production';
};

// Default production origins - platform.com and pages.dev subdomains
const DEFAULT_PRODUCTION_ORIGINS = [
  // platform.com
  '*.platform.com',
  'platform.com',
  'alfa.platform.com',
  'beta.platform.com',
  'dev.platform.com',
  'demo.platform.com',
  'web.platform.com',
  'prod.platform.com',
  'app.platform.com',
  // platform.pages.dev
  '*.platform.pages.dev',
  'platform.pages.dev',
  'alfa.platform.pages.dev',
  'beta.platform.pages.dev',
  'dev.platform.pages.dev',
  'demo.platform.pages.dev',
  'prod.platform.pages.dev',
  // id3a.cz (Supabase custom domain)
  '*.id3a.cz',
  'id3a.cz',
  'supabase.id3a.cz',
  'app.id3a.cz',
].join(',');

const getEdgeRuntimeMode = (): EdgeRuntimeMode => {
  // Explicit override (if set) wins.
  const explicit = readNonEmptyString(Deno.env.get('EDGE_RUNTIME_MODE'));
  if (explicit === 'development' || explicit === 'production') return explicit;

  // Otherwise infer from Supabase URL (safe + works locally).
  return inferModeFromSupabaseUrl(readNonEmptyString(Deno.env.get('SUPABASE_URL')));
};

export const getAllowedOriginsRaw = (params?: { allowPublicFallback?: boolean }): string | undefined => {
  const raw = readNonEmptyString(Deno.env.get('ALLOWED_ORIGINS'));
  if (raw) return raw;

  // Public endpoints may intentionally be open.
  if (params?.allowPublicFallback) return '*';

  const mode = getEdgeRuntimeMode();

  // In local development, default to permissive CORS if not configured
  // so dev builds keep working without extra secrets.
  if (mode === 'development') return '*';

  // In production, use default allowed origins for platform domains
  const allowAllInProd = isTruthyBoolean(Deno.env.get('EDGE_ALLOW_ALL_ORIGINS_IF_UNSET_IN_PROD'));
  if (allowAllInProd) return '*';

  // Return default production origins for platform.com and pages.dev subdomains
  return DEFAULT_PRODUCTION_ORIGINS;
};

export const getOpenAiApiUrl = (): string => {
  return (
    readNonEmptyString(Deno.env.get('OPENAI_API_URL')) ??
    'https://api.openai.com/v1/chat/completions'
  );
};

export const getAnalyzeTrackingDocumentModel = (): string => {
  return readNonEmptyString(Deno.env.get('ANALYZE_TRACKING_DOCUMENT_MODEL')) ?? 'gpt-5-mini';
};

export const getPublicPartnersDirectoryConfig = (): {
  allowedOriginsRaw: string;
  requestsPerHourPerIp: number;
  maxResults: number;
} => {
  return {
    allowedOriginsRaw: getAllowedOriginsRaw({ allowPublicFallback: true }) ?? '*',
    requestsPerHourPerIp: readNonNegativeInt(
      Deno.env.get('PUBLIC_PARTNERS_DIRECTORY_REQUESTS_PER_HOUR_PER_IP'),
      120,
    ),
    maxResults: readNonNegativeInt(Deno.env.get('PUBLIC_PARTNERS_DIRECTORY_MAX_RESULTS'), 500),
  };
};

export const getHealthDocumentDownloadConfig = (): {
  allowedOriginsRaw: string | undefined;
  downloadsPerHour: number;
} => {
  return {
    allowedOriginsRaw: getAllowedOriginsRaw(),
    downloadsPerHour: readNonNegativeInt(Deno.env.get('DOWNLOAD_HEALTH_DOCUMENTS_PER_HOUR'), 50),
  };
};

export const getUploadHealthDocumentPreflightConfig = (): {
  allowedOriginsRaw: string | undefined;
  maxFileSizeBytes: number;
  preflightsPerHour: number;
} => {
  return {
    allowedOriginsRaw: getAllowedOriginsRaw(),
    maxFileSizeBytes: readNonNegativeInt(
      Deno.env.get('UPLOAD_HEALTH_DOCUMENT_MAX_FILE_SIZE_BYTES'),
      50 * 1024 * 1024,
    ),
    preflightsPerHour: readNonNegativeInt(Deno.env.get('UPLOAD_PREFLIGHTS_PER_HOUR'), 10),
  };
};

export const getRecordBlockchainAuditConfig = (): {
  allowedOriginsRaw: string | undefined;
  auditRequestsPerHour: number;
  maxRequestBodyBytes: number;
  maxPayloadJsonChars: number;
} => {
  return {
    allowedOriginsRaw: getAllowedOriginsRaw(),
    auditRequestsPerHour: readNonNegativeInt(Deno.env.get('BLOCKCHAIN_AUDIT_REQUESTS_PER_HOUR'), 60),
    maxRequestBodyBytes: readNonNegativeInt(Deno.env.get('BLOCKCHAIN_AUDIT_MAX_REQUEST_BODY_BYTES'), 100 * 1024),
    maxPayloadJsonChars: readNonNegativeInt(Deno.env.get('BLOCKCHAIN_AUDIT_MAX_PAYLOAD_JSON_CHARS'), 50_000),
  };
};
