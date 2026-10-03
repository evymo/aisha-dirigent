import type {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * AISHA MCP API credential.
 *
 * Stores the MCP server URL + Keycloak/OAuth bearer for MCP JSON-RPC 2.0 invocations.
 * Used by AishaModelRouter and any MCP-bridging nodes.
 */
export class AishaMcpApi implements ICredentialType {
	name = 'aishaMcpApi';
	displayName = 'AISHA MCP API';
	documentationUrl = 'https://github.com/evymo/aisha-dirigent/blob/main/docs/MCP_SCOPE_REFERENCE.md';
	icon = 'file:../nodes/AishaRpc/aisha.svg' as const;

	properties: INodeProperties[] = [
		{
			displayName: 'MCP Server URL',
			name: 'mcpServerUrl',
			type: 'string',
			default: '',
			placeholder: 'https://your-project.supabase.co/functions/v1/mcp-knowledge-server',
			description: 'URL of the MCP Knowledge Server endpoint',
			required: true,
		},
		{
			displayName: 'Keycloak Access Token',
			name: 'accessToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'Keycloak/OAuth bearer token for MCP server authentication',
			required: true,
		},
		{
			displayName: 'Scope',
			name: 'scope',
			type: 'options',
			options: [
				{ name: 'Account (Full)', value: 'account' },
				{ name: 'Project', value: 'project' },
				{ name: 'Session', value: 'session' },
			],
			default: 'account',
			description: 'Token scope — controls which MCP tools are accessible',
		},
	];
}
