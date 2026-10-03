import { DEV_FALLBACK_DB_URL } from '@/config/devFallbackDb';

type SupabaseConfigSource = 'env' | 'dev-fallback';

const maskMiddle = (value: string, head = 4, tail = 4) => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= head + tail + 1) return trimmed;
  return `${trimmed.slice(0, head)}…${trimmed.slice(-tail)}`;
};

const getSupabaseConfigSource = (url: string | undefined, key: string | undefined): SupabaseConfigSource => {
  // Mirrors the client decision: if either URL or key is missing, it falls back.
  if (url && key) return 'env';
  return 'dev-fallback';
};

const getSupabaseUrl = (): { url: string; source: SupabaseConfigSource } => {
  const url = import.meta.env.VITE_AISHA_GATEWAY_URL as string | undefined;
  const anonKeyRaw = import.meta.env.VITE_AISHA_GATEWAY_KEY as string | undefined;

  // Treat empty strings as "not provided".
  const anonKey = anonKeyRaw?.trim() ? anonKeyRaw : undefined;
  const key = anonKey;

  const source = getSupabaseConfigSource(url, key);
  if (source === 'env') return { url: url as string, source };

  return { url: DEV_FALLBACK_DB_URL, source };
};

const deriveBackendInstanceId = (url: string): string | null => {
  try {
    const hostname = new URL(url).hostname;
    return hostname;
  } catch {
    return null;
  }
};

export type BackendInstanceInfo = {
  source: SupabaseConfigSource;
  id: string | null;
  maskedId: string | null;
};

export const getBackendInstanceInfo = (): BackendInstanceInfo => {
  const { url, source } = getSupabaseUrl();
  const id = deriveBackendInstanceId(url);

  if (!id) {
    return { source, id: null, maskedId: null };
  }

  if (id.startsWith('sb:')) {
    const ref = id.slice(3);
    const maskedRef = maskMiddle(ref);
    return { source, id, maskedId: maskedRef ? `sb:${maskedRef}` : null };
  }

  return { source, id, maskedId: maskMiddle(id) };
};
