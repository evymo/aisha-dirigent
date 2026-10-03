import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { requireCredString, requirePostgrestUrl } from '../_shared/credentials';
import { fetchWithTimeout } from '../_shared/fetchWithTimeout';

/**
 * Aisha GitHub App Node — GitHub repository operations via AISHA installation tokens.
 *
 * Wraps the `github-repo-ops` edge function to provide typed, auditable
 * GitHub operations within n8n workflows. Automatically resolves installation
 * tokens from story context or explicit installation_id.
 *
 * Operations: create_repo, get_repo, get_contents, create_branch, commit_file,
 * create_pr, merge_pr, create_issue, create_check_run, dispatch_workflow,
 * list_branches, get_pull_request, compare_commits.
 */
export class AishaGitHubApp implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AISHA GitHub App',
		name: 'aishaGitHubApp',
		icon: 'file:aisha.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] }}',
		description: 'Execute GitHub repository operations via AISHA GitHub App installation tokens',
		defaults: {
			name: 'GitHub App',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'aishaPostgrestApi',
				required: true,
			},
		],
		properties: [
			// ── Operation ──
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Compare Commits', value: 'compare_commits', description: 'Compare two git refs' },
					{ name: 'Commit File', value: 'commit_file', description: 'Create or update a single file' },
					{ name: 'Create Branch', value: 'create_branch', description: 'Create a new branch from a ref' },
					{ name: 'Create Check Run', value: 'create_check_run', description: 'Create a CI check run status' },
					{ name: 'Create Issue', value: 'create_issue', description: 'Create an issue on the repo' },
					{ name: 'Create PR', value: 'create_pr', description: 'Open a pull request' },
					{ name: 'Create Repo', value: 'create_repo', description: 'Create a new repository' },
					{ name: 'Dispatch Workflow', value: 'dispatch_workflow', description: 'Trigger a GitHub Actions workflow' },
					{ name: 'Get Contents', value: 'get_contents', description: 'Read file or directory contents' },
					{ name: 'Get PR', value: 'get_pull_request', description: 'Get pull request details' },
					{ name: 'Get Repo', value: 'get_repo', description: 'Get repository metadata' },
					{ name: 'List Branches', value: 'list_branches', description: 'List all branches' },
					{ name: 'Merge PR', value: 'merge_pr', description: 'Merge a pull request' },
				],
				default: 'get_contents',
				description: 'GitHub API operation to perform',
			},
			// ── Installation ID ──
			{
				displayName: 'Installation ID',
				name: 'installationId',
				type: 'number',
				default: 0,
				required: true,
				description: 'GitHub App installation ID (from github_app_installations table)',
			},
			// ── Common: Owner/Repo ──
			{
				displayName: 'Owner',
				name: 'owner',
				type: 'string',
				default: '',
				required: true,
				description: 'GitHub organization or user (e.g. "aisha")',
				placeholder: 'aisha',
			},
			{
				displayName: 'Repo',
				name: 'repo',
				type: 'string',
				default: '',
				required: true,
				description: 'Repository name (e.g. "my-project")',
				displayOptions: {
					hide: { operation: ['create_repo'] },
				},
			},
			// ── create_repo params ──
			{
				displayName: 'Repo Name',
				name: 'repoName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['create_repo'] } },
				description: 'Name of the new repository',
			},
			{
				displayName: 'Private',
				name: 'isPrivate',
				type: 'boolean',
				default: true,
				displayOptions: { show: { operation: ['create_repo'] } },
				description: 'Whether the new repo should be private',
			},
			// ── get_contents / commit_file: path ──
			{
				displayName: 'Path',
				name: 'path',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['get_contents', 'commit_file'] } },
				description: 'File or directory path in the repo',
				placeholder: 'src/index.ts',
			},
			// ── Ref / Branch (multiple operations) ──
			{
				displayName: 'Branch',
				name: 'branch',
				type: 'string',
				default: 'main',
				displayOptions: {
					show: { operation: ['get_contents', 'commit_file', 'create_branch', 'dispatch_workflow'] },
				},
				description: 'Branch name or ref',
			},
			// ── create_branch: from_ref ──
			{
				displayName: 'From Ref',
				name: 'fromRef',
				type: 'string',
				default: 'main',
				displayOptions: { show: { operation: ['create_branch'] } },
				description: 'Source ref to create branch from',
			},
			// ── commit_file ──
			{
				displayName: 'Content',
				name: 'content',
				type: 'string',
				typeOptions: { rows: 10 },
				default: '',
				displayOptions: { show: { operation: ['commit_file'] } },
				description: 'File content to commit',
			},
			{
				displayName: 'Commit Message',
				name: 'commitMessage',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['commit_file'] } },
				description: 'Git commit message',
			},
			// ── create_pr / merge_pr ──
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['create_pr', 'create_issue'] } },
				description: 'PR or issue title',
			},
			{
				displayName: 'Body',
				name: 'body',
				type: 'string',
				typeOptions: { rows: 5 },
				default: '',
				displayOptions: { show: { operation: ['create_pr', 'create_issue'] } },
				description: 'PR or issue body text',
			},
			{
				displayName: 'Head Branch',
				name: 'head',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['create_pr'] } },
				description: 'Source branch for the PR',
			},
			{
				displayName: 'Base Branch',
				name: 'base',
				type: 'string',
				default: 'main',
				displayOptions: { show: { operation: ['create_pr'] } },
				description: 'Target branch for the PR',
			},
			{
				displayName: 'PR Number',
				name: 'prNumber',
				type: 'number',
				default: 0,
				displayOptions: { show: { operation: ['merge_pr', 'get_pull_request'] } },
				description: 'Pull request number',
			},
			{
				displayName: 'Merge Method',
				name: 'mergeMethod',
				type: 'options',
				options: [
					{ name: 'Merge', value: 'merge' },
					{ name: 'Squash', value: 'squash' },
					{ name: 'Rebase', value: 'rebase' },
				],
				default: 'squash',
				displayOptions: { show: { operation: ['merge_pr'] } },
			},
			// ── create_check_run ──
			{
				displayName: 'Check Name',
				name: 'checkName',
				type: 'string',
				default: 'AISHA Compliance',
				displayOptions: { show: { operation: ['create_check_run'] } },
			},
			{
				displayName: 'Head SHA',
				name: 'headSha',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['create_check_run', 'compare_commits'] } },
			},
			{
				displayName: 'Status',
				name: 'checkStatus',
				type: 'options',
				options: [
					{ name: 'Queued', value: 'queued' },
					{ name: 'In Progress', value: 'in_progress' },
					{ name: 'Completed', value: 'completed' },
				],
				default: 'completed',
				displayOptions: { show: { operation: ['create_check_run'] } },
			},
			{
				displayName: 'Conclusion',
				name: 'conclusion',
				type: 'options',
				options: [
					{ name: 'Success', value: 'success' },
					{ name: 'Failure', value: 'failure' },
					{ name: 'Neutral', value: 'neutral' },
					{ name: 'Action Required', value: 'action_required' },
				],
				default: 'success',
				displayOptions: { show: { operation: ['create_check_run'] } },
			},
			{
				displayName: 'Output',
				name: 'checkOutput',
				type: 'json',
				default: '{}',
				displayOptions: { show: { operation: ['create_check_run'] } },
				description: 'Check run output JSON: { title, summary, text }',
			},
			// ── compare_commits ──
			{
				displayName: 'Base Ref',
				name: 'baseRef',
				type: 'string',
				default: 'main',
				displayOptions: { show: { operation: ['compare_commits'] } },
			},
			// ── dispatch_workflow ──
			{
				displayName: 'Workflow ID',
				name: 'workflowId',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['dispatch_workflow'] } },
				description: 'Action workflow file name (e.g. "deploy.yml")',
			},
			{
				displayName: 'Workflow Inputs',
				name: 'workflowInputs',
				type: 'json',
				default: '{}',
				displayOptions: { show: { operation: ['dispatch_workflow'] } },
				description: 'JSON inputs for the workflow',
			},
			// ── Issue labels/assignees ──
			{
				displayName: 'Labels',
				name: 'labels',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['create_issue'] } },
				description: 'Comma-separated labels',
			},
			// ── Options ──
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Timeout (ms)',
						name: 'timeout',
						type: 'number',
						default: 30000,
						description: 'Request timeout in milliseconds',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const credentials = await this.getCredentials('aishaPostgrestApi');

		const supabaseUrl = requirePostgrestUrl(credentials, this.getNode());
		const serviceKey = requireCredString(credentials, 'serviceRoleKey', this.getNode());

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const installationId = this.getNodeParameter('installationId', i) as number;
				const owner = this.getNodeParameter('owner', i, '') as string;
				const options = this.getNodeParameter('options', i, {}) as { timeout?: number };

				if (!installationId) {
					throw new NodeOperationError(
						this.getNode(),
						'Installation ID is required',
						{ itemIndex: i },
					);
				}

				// Build operation-specific params
				const params: Record<string, unknown> = { owner };

				switch (operation) {
					case 'create_repo':
						params.name = this.getNodeParameter('repoName', i) as string;
						params.private = this.getNodeParameter('isPrivate', i) as boolean;
						break;

					case 'get_repo':
					case 'list_branches':
						params.repo = this.getNodeParameter('repo', i) as string;
						break;

					case 'get_contents':
						params.repo = this.getNodeParameter('repo', i) as string;
						params.path = this.getNodeParameter('path', i, '') as string;
						params.ref = this.getNodeParameter('branch', i, 'main') as string;
						break;

					case 'create_branch':
						params.repo = this.getNodeParameter('repo', i) as string;
						params.branch = this.getNodeParameter('branch', i) as string;
						params.from_ref = this.getNodeParameter('fromRef', i, 'main') as string;
						break;

					case 'commit_file':
						params.repo = this.getNodeParameter('repo', i) as string;
						params.path = this.getNodeParameter('path', i) as string;
						params.content = this.getNodeParameter('content', i) as string;
						params.message = this.getNodeParameter('commitMessage', i) as string;
						params.branch = this.getNodeParameter('branch', i, 'main') as string;
						break;

					case 'create_pr':
						params.repo = this.getNodeParameter('repo', i) as string;
						params.title = this.getNodeParameter('title', i) as string;
						params.body = this.getNodeParameter('body', i, '') as string;
						params.head = this.getNodeParameter('head', i) as string;
						params.base = this.getNodeParameter('base', i, 'main') as string;
						break;

					case 'merge_pr':
						params.repo = this.getNodeParameter('repo', i) as string;
						params.pull_number = this.getNodeParameter('prNumber', i) as number;
						params.merge_method = this.getNodeParameter('mergeMethod', i, 'squash') as string;
						break;

					case 'get_pull_request':
						params.repo = this.getNodeParameter('repo', i) as string;
						params.pull_number = this.getNodeParameter('prNumber', i) as number;
						break;

					case 'create_issue':
						params.repo = this.getNodeParameter('repo', i) as string;
						params.title = this.getNodeParameter('title', i) as string;
						params.body = this.getNodeParameter('body', i, '') as string;
						{
							const labelsStr = this.getNodeParameter('labels', i, '') as string;
							if (labelsStr) {
								params.labels = labelsStr.split(',').map((l) => l.trim()).filter(Boolean);
							}
						}
						break;

					case 'create_check_run':
						params.repo = this.getNodeParameter('repo', i) as string;
						params.name = this.getNodeParameter('checkName', i) as string;
						params.head_sha = this.getNodeParameter('headSha', i) as string;
						params.status = this.getNodeParameter('checkStatus', i) as string;
						params.conclusion = this.getNodeParameter('conclusion', i) as string;
						{
							const outputStr = this.getNodeParameter('checkOutput', i, '{}') as string;
							try {
								params.output = JSON.parse(outputStr);
							} catch (err) {
								console.warn(`[AishaGitHubApp] invalid checkOutput JSON, defaulting to {}: ${(err as Error)?.message || err}`);
								params.output = {};
							}
						}
						break;

					case 'dispatch_workflow':
						params.repo = this.getNodeParameter('repo', i) as string;
						params.workflow_id = this.getNodeParameter('workflowId', i) as string;
						params.ref = this.getNodeParameter('branch', i, 'main') as string;
						{
							const inputsStr = this.getNodeParameter('workflowInputs', i, '{}') as string;
							try {
								params.inputs = JSON.parse(inputsStr);
							} catch (err) {
								console.warn(`[AishaGitHubApp] invalid workflowInputs JSON, defaulting to {}: ${(err as Error)?.message || err}`);
								params.inputs = {};
							}
						}
						break;

					case 'compare_commits':
						params.repo = this.getNodeParameter('repo', i) as string;
						params.base = this.getNodeParameter('baseRef', i) as string;
						params.head = this.getNodeParameter('headSha', i) as string;
						break;
				}

				// Call github-repo-ops edge function
				const url = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/github-repo-ops`;
				const timeoutMs = options.timeout ?? 30000;

				const response = await fetchWithTimeout(
					url,
					{
						method: 'POST',
						headers: {
							Authorization: `Bearer ${serviceKey}`,
							'Content-Type': 'application/json',
						},
						body: JSON.stringify({
							operation,
							installation_id: installationId,
							params,
						}),
					},
					timeoutMs,
				);

				const responseData = (await response.json()) as Record<string, unknown>;

				if (!response.ok || responseData.ok === false) {
					const errMsg =
						(responseData.error as string) ??
						JSON.stringify(responseData.data ?? responseData);
					throw new NodeOperationError(
						this.getNode(),
						`GitHub ${operation} failed [${responseData.github_status ?? response.status}]: ${errMsg}`,
						{ itemIndex: i },
					);
				}

				returnData.push({
					json: responseData as IDataObject,
				});
			} catch (error) {
				if (error instanceof NodeOperationError) throw error;
				throw new NodeOperationError(
					this.getNode(),
					`GitHub App operation failed: ${(error as Error).message}`,
					{ itemIndex: i },
				);
			}
		}

		return [returnData];
	}
}
