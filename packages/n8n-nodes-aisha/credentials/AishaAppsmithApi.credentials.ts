import type {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * Appsmith API credential.
 *
 * Stores the Appsmith base URL + API key for Aisha's
 * dashboard management operations (pages, deploy, git sync).
 *
 * @see https://docs.appsmith.com/connect-data/reference/rest-api
 */
export class AishaAppsmithApi implements ICredentialType {
	name = 'aishaAppsmithApi';
	displayName = 'AISHA Appsmith API';
	documentationUrl = 'https://docs.appsmith.com/connect-data/reference/rest-api';
	icon = 'file:../nodes/AishaAdminBridge/aisha.svg' as const;

	properties: INodeProperties[] = [
		{
			displayName: 'Appsmith Base URL',
			name: 'baseUrl',
			type: 'string',
			default: '',
			placeholder: 'https://appsmith.aisha.guru',
			description: 'Base URL of the Appsmith instance (without /api/v1)',
			required: true,
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'Appsmith API key (Profile → API Key)',
			required: true,
		},
	];
}
