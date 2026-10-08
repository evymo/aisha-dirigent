import type {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * NocoDB API credential.
 *
 * Stores the NocoDB base URL + API token for Aisha's autonomous
 * admin bridge operations (table management, view CRUD, schema sync).
 *
 * @see https://docs.nocodb.com/developer-resources/rest-APIs
 */
export class AishaNocoDbApi implements ICredentialType {
	name = 'aishaNocoDbApi';
	displayName = 'AISHA NocoDB API';
	documentationUrl = 'https://docs.nocodb.com/developer-resources/rest-APIs';
	icon = 'file:../nodes/AishaAdminBridge/aisha.svg' as const;

	properties: INodeProperties[] = [
		{
			displayName: 'NocoDB Base URL',
			name: 'baseUrl',
			type: 'string',
			default: '',
			placeholder: 'http://localhost:8085',
			description: 'Base URL of the NocoDB instance',
			required: true,
		},
		{
			displayName: 'API Token',
			name: 'apiToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'NocoDB API token (Settings → API Tokens)',
			required: true,
		},
	];
}
