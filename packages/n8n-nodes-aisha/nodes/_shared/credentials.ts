import type { INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/**
 * Safely extract a string credential, throwing if missing or empty.
 *
 * Prevents runtime crashes from `(credentials.X as string).method()`
 * when the credential is undefined.
 *
 * @param credentials - Raw credential object from getCredentials()
 * @param key - Credential property name (e.g. 'postgrestUrl', 'apiToken')
 * @param node - n8n node reference for error context
 * @returns The credential value as a non-empty string
 * @throws NodeOperationError if credential is missing or empty
 */
export function requireCredString(
	credentials: Record<string, unknown>,
	key: string,
	node: INode,
): string {
	const val = credentials[key];
	if (typeof val !== 'string' || !val) {
		throw new NodeOperationError(node, `Missing or empty credential: ${key}`);
	}
	return val;
}

/**
 * Extract the AISHA PostgREST base URL from an `aishaPostgrestApi` credential.
 *
 * The credential class (AishaPostgrestApi.credentials.ts) defines the URL
 * property as `postgrestUrl`. This helper reads it and throws a clear error
 * rather than silently returning `undefined` and building a broken request URL.
 * Credentials are (re)provisioned with the canonical `postgrestUrl` key by
 * scripts/n8n/provision-credentials.mjs.
 *
 * @param credentials - Raw credential object from getCredentials('aishaPostgrestApi')
 * @param node - n8n node reference for error context
 * @returns The PostgREST base URL as a non-empty string
 * @throws NodeOperationError if postgrestUrl is missing or empty
 */
export function requirePostgrestUrl(
	credentials: Record<string, unknown>,
	node: INode,
): string {
	const primary = credentials['postgrestUrl'];
	if (typeof primary === 'string' && primary) return primary;
	throw new NodeOperationError(node, 'Missing or empty credential: postgrestUrl');
}
