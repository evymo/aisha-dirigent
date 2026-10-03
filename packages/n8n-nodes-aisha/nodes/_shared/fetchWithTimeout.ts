/**
 * Default timeout for HTTP requests in n8n nodes (30 seconds).
 */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Fetch wrapper with automatic timeout via AbortSignal.
 *
 * Prevents hanging requests when external services are unresponsive.
 * Uses AbortSignal.timeout() for clean cancellation.
 *
 * @param url - Request URL
 * @param init - Standard fetch RequestInit options
 * @param timeoutMs - Timeout in milliseconds (default: 30000)
 * @returns Fetch Response
 */
export function fetchWithTimeout(
	url: string,
	init?: RequestInit,
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
	return fetch(url, {
		...init,
		signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
	});
}
