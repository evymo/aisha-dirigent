import type {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * AISHA PostgREST API credential.
 *
 * Stores the AISHA PostgREST URL + Service Role JWT for direct RPC invocations.
 * Used by AishaRpc, AishaAudit, AishaStoryManager and other AISHA nodes that
 * talk to the PostgREST API gateway exposing AISHA's RPC surface.
 *
 * History: this credential type was previously named `aishaSupabaseApi`
 * (back when the stack ran on the Supabase platform). The migration off
 * Supabase to a Fastify + PostgREST orchestrator (2026-Q1) made that name
 * a misleading leftover. Renamed to `aishaPostgrestApi` in May 2026 (PR #82).
 */
export class AishaPostgrestApi implements ICredentialType {
	name = 'aishaPostgrestApi';
	displayName = 'AISHA PostgREST API';
	documentationUrl = 'https://github.com/evymo/aisha-dirigent/blob/main/docs/N8N_COMMUNITY_NODES.md';
	icon = 'file:../nodes/AishaRpc/aisha.svg' as const;

	properties: INodeProperties[] = [
		{
			displayName: 'PostgREST URL',
			name: 'postgrestUrl',
			type: 'string',
			default: '',
			placeholder: 'https://api.aisha.example.com',
			description: 'The URL of the AISHA PostgREST API gateway',
			required: true,
		},
		{
			displayName: 'Service Role Key',
			name: 'serviceRoleKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'PostgREST service_role JWT — has full DB access, bypasses RLS',
			required: true,
		},
		{
			displayName: 'Anon Key',
			name: 'anonKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'PostgREST anon JWT — used for public/RLS-respecting calls (optional)',
		},
	];
}
