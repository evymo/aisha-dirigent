import type {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * Forgejo API credential.
 *
 * Stores the Forgejo base URL + API token for Aisha's Git
 * operations (branches, commits, pull requests).
 *
 * @see https://forgejo.org/docs/latest/developer/api-usage/
 */
export class AishaForgejoApi implements ICredentialType {
	name = 'aishaForgejoApi';
	displayName = 'AISHA Forgejo API';
	documentationUrl = 'https://forgejo.org/docs/latest/developer/api-usage/';
	icon = 'file:../nodes/AishaAdminBridge/aisha.svg' as const;

	properties: INodeProperties[] = [
		{
			displayName: 'Forgejo Base URL',
			name: 'baseUrl',
			type: 'string',
			default: '',
			placeholder: 'https://git.id3a.cz',
			description: 'Base URL of the Forgejo instance (without /api/v1)',
			required: true,
		},
		{
			displayName: 'API Token',
			name: 'apiToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'Forgejo personal access token (Settings → Applications → Access Tokens)',
			required: true,
		},
	];
}
