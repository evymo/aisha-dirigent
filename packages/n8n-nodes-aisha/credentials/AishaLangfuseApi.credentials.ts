import type {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * Langfuse API credential.
 *
 * Stores the Langfuse host, public key, and secret key for
 * LLM observability, tracing, and analytics operations.
 *
 * @see https://langfuse.com/docs/api-reference
 */
export class AishaLangfuseApi implements ICredentialType {
	name = 'aishaLangfuseApi';
	displayName = 'AISHA Langfuse API';
	documentationUrl = 'https://langfuse.com/docs/api-reference';
	icon = 'file:../nodes/AishaAdminBridge/aisha.svg' as const;

	properties: INodeProperties[] = [
		{
			displayName: 'Langfuse Host',
			name: 'host',
			type: 'string',
			default: '',
			placeholder: 'https://langfuse.aisha.guru',
			description: 'Self-hosted Langfuse base URL',
			required: true,
		},
		{
			displayName: 'Public Key',
			name: 'publicKey',
			type: 'string',
			default: '',
			placeholder: 'pk-lf-...',
			description: 'Langfuse project public key',
			required: true,
		},
		{
			displayName: 'Secret Key',
			name: 'secretKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			placeholder: 'sk-lf-...',
			description: 'Langfuse project secret key',
			required: true,
		},
	];
}
