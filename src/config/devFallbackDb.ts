type UnknownEnv = Record<string, unknown>;

const getMetaEnv = (): UnknownEnv => {
	const meta = import.meta as unknown as { env?: UnknownEnv };
	return meta.env ?? {};
};

const readNonEmptyString = (value: unknown): string | undefined => {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
};

// Dev-only fallback for environments that cannot inject VITE_* vars (e.g., preview/CI builds).
// This is intentionally non-secret (public/publishable/anon key) and MUST NEVER be relied
// upon in production.
const DEFAULT_DEV_FALLBACK_DB_URL =
	readNonEmptyString(getMetaEnv().VITE_DEV_FALLBACK_URL) ?? 'http://localhost:5678';
const DEFAULT_DEV_FALLBACK_DB_ANON_KEY =
	readNonEmptyString(getMetaEnv().VITE_DEV_FALLBACK_KEY) ?? '';

/**
 * Fallback API/DB URL pro DEV prostředí.
 *
 * Používá se, pokud nejsou nastaveny environment variables (např. v preview/CI prostředí).
 * NIKDY nepoužívat v produkci.
 */
export const DEV_FALLBACK_DB_URL =
	readNonEmptyString(getMetaEnv().VITE_DEV_FALLBACK_DB_URL) ??
	DEFAULT_DEV_FALLBACK_DB_URL;

/**
 * Fallback anon key pro DEV prostředí.
 *
 * Veřejný klíč pro anonymní přístup. Prázdný string = žádný klíč.
 * NIKDY nepoužívat v produkci.
 */
export const DEV_FALLBACK_DB_ANON_KEY =
	readNonEmptyString(getMetaEnv().VITE_DEV_FALLBACK_DB_ANON_KEY) ??
	DEFAULT_DEV_FALLBACK_DB_ANON_KEY;
