import type {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * GitHub REST API credential.
 *
 * Stores the GitHub REST API base URL + token for Aisha's Git operations
 * (branches, commits, pull requests, commit statuses) in AishaAdminBridge.
 *
 * The API URL defaults to the public GitHub API; GitHub Enterprise Server
 * overrides it with `https://<host>/api/v3`. The repository itself is NOT part
 * of the credential — workflows pass owner/repo explicitly (from
 * `GITHUB_REPOSITORY`), and the node fails closed when it is empty.
 *
 * @see https://docs.github.com/en/rest
 */
export class AishaGitHubApi implements ICredentialType {
	name = 'aishaGitHubApi';
	displayName = 'AISHA GitHub API';
	documentationUrl = 'https://docs.github.com/en/rest';
	icon = 'file:../nodes/AishaAdminBridge/aisha.svg' as const;

	properties: INodeProperties[] = [
		{
			displayName: 'API URL',
			name: 'apiUrl',
			type: 'string',
			default: 'https://api.github.com',
			placeholder: 'https://api.github.com',
			description:
				'GitHub REST API base URL. Public GitHub: https://api.github.com; GitHub Enterprise Server: https://<host>/api/v3',
			required: true,
		},
		{
			displayName: 'API Token',
			name: 'apiToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'GitHub token (fine-grained personal access token or GitHub App installation token) with contents, pull requests and commit statuses access to the repository',
			required: true,
		},
	];
}
