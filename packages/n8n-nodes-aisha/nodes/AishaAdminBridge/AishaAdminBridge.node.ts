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
 * AishaAdminBridge — Aisha's autonomous admin interface node.
 *
 * Provides unified access to NocoDB (table management, CRUD, views),
 * Langfuse (traces, sessions, scores, metrics), and Forgejo (Git ops)
 * so Aisha can self-manage internal admin panels without React UI.
 *
 * @example
 * // NocoDB: List tables
 * operation: 'nocodb_list_tables'
 *
 * // Langfuse: Get trace summary
 * operation: 'langfuse_get_traces'
 *
 * // Forgejo: Create a PR
 * operation: 'forgejo_create_pr'
 */
export class AishaAdminBridge implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AISHA Admin Bridge',
		name: 'aishaAdminBridge',
		icon: 'file:aisha.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["service"] + ": " + $parameter["operation"] }}',
		description: 'Aisha Admin Bridge — NocoDB + Langfuse + Forgejo + Appsmith operations',
		defaults: {
			name: 'Admin Bridge',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'aishaNocoDbApi',
				required: false,
				displayOptions: { show: { service: ['nocodb'] } },
			},
			{
				name: 'aishaLangfuseApi',
				required: false,
				displayOptions: { show: { service: ['langfuse'] } },
			},
			{
				name: 'aishaForgejoApi',
				required: false,
				displayOptions: { show: { service: ['forgejo'] } },
			},
			{
				name: 'aishaAppsmithApi',
				required: false,
				displayOptions: { show: { service: ['appsmith'] } },
			},
			{
				name: 'aishaPostgrestApi',
				required: false,
			},
		],
		properties: [
			// ── Service selector ──
			{
				displayName: 'Service',
				name: 'service',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'NocoDB',
						value: 'nocodb',
						description: 'Spreadsheet-like admin interface operations',
					},
					{
						name: 'Langfuse',
						value: 'langfuse',
						description: 'LLM observability and tracing operations',
					},
					{
						name: 'Forgejo',
						value: 'forgejo',
						description: 'Git operations — branches, commits, pull requests',
					},
					{
						name: 'Appsmith',
						value: 'appsmith',
						description: 'Dashboard management — pages, deploy, git sync',
					},
					{
						name: 'Health Check',
						value: 'health',
						description: 'Check health of all integration services',
					},
				],
				default: 'nocodb',
			},

			// ═══════════════════════════════════════════════════════════════
			// NocoDB Operations
			// ═══════════════════════════════════════════════════════════════
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { service: ['nocodb'] } },
				options: [
					{
						name: 'List Tables',
						value: 'list_tables',
						description: 'List all tables/bases visible to NocoDB',
						action: 'List NocoDB tables',
					},
					{
						name: 'Get Table Schema',
						value: 'get_schema',
						description: 'Get column definitions for a table',
						action: 'Get table schema',
					},
					{
						name: 'List Records',
						value: 'list_records',
						description: 'List records from a NocoDB table/view',
						action: 'List records from table',
					},
					{
						name: 'Create Record',
						value: 'create_record',
						description: 'Insert a new record into a NocoDB table',
						action: 'Create a record',
					},
					{
						name: 'Update Record',
						value: 'update_record',
						description: 'Update an existing record in a NocoDB table',
						action: 'Update a record',
					},
					{
						name: 'Delete Record',
						value: 'delete_record',
						description: 'Delete a record from a NocoDB table',
						action: 'Delete a record',
					},
					{
						name: 'Create View',
						value: 'create_view',
						description: 'Create a new view (grid, form, gallery, kanban) for a table',
						action: 'Create a view',
					},
					{
						name: 'Run Formula',
						value: 'run_formula',
						description: 'Execute a NocoDB formula column or aggregation',
						action: 'Run formula/aggregation',
					},
				],
				default: 'list_tables',
			},

			// ═══════════════════════════════════════════════════════════════
			// Langfuse Operations
			// ═══════════════════════════════════════════════════════════════
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { service: ['langfuse'] } },
				options: [
					{
						name: 'Get Traces',
						value: 'get_traces',
						description: 'List traces with optional filters',
						action: 'Get LLM traces',
					},
					{
						name: 'Get Sessions',
						value: 'get_sessions',
						description: 'List conversation sessions',
						action: 'Get sessions',
					},
					{
						name: 'Get Metrics',
						value: 'get_metrics',
						description: 'Get usage metrics (cost, latency, token counts)',
						action: 'Get usage metrics',
					},
					{
						name: 'Create Score',
						value: 'create_score',
						description: 'Create a quality/feedback score on a trace',
						action: 'Create a score',
					},
					{
						name: 'Get Generations',
						value: 'get_generations',
						description: 'List LLM generations with model/cost data',
						action: 'Get generations',
					},
					{
						name: 'Get Datasets',
						value: 'get_datasets',
						description: 'List evaluation datasets',
						action: 'Get evaluation datasets',
					},
				],
				default: 'get_traces',
			},

			// ═══════════════════════════════════════════════════════════════
			// Forgejo Operations
			// ═══════════════════════════════════════════════════════════════
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { service: ['forgejo'] } },
				options: [
					{
						name: 'List Repos',
						value: 'list_repos',
						description: 'Search repositories accessible to Aisha',
						action: 'List Git repositories',
					},
					{
						name: 'Create Branch',
						value: 'create_branch',
						description: 'Create a new branch from a base reference',
						action: 'Create a Git branch',
					},
					{
						name: 'Commit File',
						value: 'commit_file',
						description: 'Create or update a file with a commit',
						action: 'Commit a file change',
					},
					{
						name: 'Create PR',
						value: 'create_pr',
						description: 'Open a new pull request',
						action: 'Create a pull request',
					},
					{
						name: 'Get Diff',
						value: 'get_diff',
						description: 'Get changed files for a pull request',
						action: 'Get PR diff files',
					},
					{
						name: 'Merge PR',
						value: 'merge_pr',
						description: 'Merge a pull request',
						action: 'Merge a pull request',
					},
				],
				default: 'list_repos',
			},

			// ═══════════════════════════════════════════════════════════════
			// Forgejo Parameters
			// ═══════════════════════════════════════════════════════════════
			{
				displayName: 'Repository Owner',
				name: 'repoOwner',
				type: 'string',
				displayOptions: {
					show: {
						service: ['forgejo'],
						operation: ['create_branch', 'commit_file', 'create_pr', 'get_diff', 'merge_pr'],
					},
				},
				default: '',
				placeholder: 'aisha',
				description: 'Repository owner (org or user)',
				required: true,
			},
			{
				displayName: 'Repository Name',
				name: 'repoName',
				type: 'string',
				displayOptions: {
					show: {
						service: ['forgejo'],
						operation: ['create_branch', 'commit_file', 'create_pr', 'get_diff', 'merge_pr'],
					},
				},
				default: '',
				placeholder: 'aisha-dirigent',
				description: 'Repository name',
				required: true,
			},
			{
				displayName: 'Branch Name',
				name: 'branchName',
				type: 'string',
				displayOptions: {
					show: {
						service: ['forgejo'],
						operation: ['create_branch', 'commit_file'],
					},
				},
				default: '',
				placeholder: 'aisha/fix-translation',
				description: 'Name of the branch to create or commit to',
				required: true,
			},
			{
				displayName: 'Base Branch',
				name: 'baseBranch',
				type: 'string',
				displayOptions: {
					show: {
						service: ['forgejo'],
						operation: ['create_branch', 'create_pr'],
					},
				},
				default: 'main',
				description: 'Base branch to branch from or merge into',
			},
			{
				displayName: 'File Path',
				name: 'filePath',
				type: 'string',
				displayOptions: {
					show: {
						service: ['forgejo'],
						operation: ['commit_file'],
					},
				},
				default: '',
				placeholder: 'src/i18n/segments/cs/core.json',
				description: 'Path to the file (relative to repo root)',
				required: true,
			},
			{
				displayName: 'File Content',
				name: 'fileContent',
				type: 'string',
				typeOptions: { rows: 10 },
				displayOptions: {
					show: {
						service: ['forgejo'],
						operation: ['commit_file'],
					},
				},
				default: '',
				description: 'New content for the file',
				required: true,
			},
			{
				displayName: 'Commit Message',
				name: 'commitMessage',
				type: 'string',
				displayOptions: {
					show: {
						service: ['forgejo'],
						operation: ['commit_file'],
					},
				},
				default: '',
				placeholder: 'fix: add missing translation key',
				description: 'Commit message',
				required: true,
			},
			{
				displayName: 'PR Title',
				name: 'prTitle',
				type: 'string',
				displayOptions: {
					show: {
						service: ['forgejo'],
						operation: ['create_pr'],
					},
				},
				default: '',
				placeholder: '[Aisha] Fix missing translation',
				description: 'Pull request title',
				required: true,
			},
			{
				displayName: 'PR Body',
				name: 'prBody',
				type: 'string',
				typeOptions: { rows: 5 },
				displayOptions: {
					show: {
						service: ['forgejo'],
						operation: ['create_pr'],
					},
				},
				default: '',
				description: 'Pull request description (markdown)',
			},
			{
				displayName: 'Head Branch',
				name: 'headBranch',
				type: 'string',
				displayOptions: {
					show: {
						service: ['forgejo'],
						operation: ['create_pr'],
					},
				},
				default: '',
				placeholder: 'aisha/fix-translation',
				description: 'Source branch for PR',
				required: true,
			},
			{
				displayName: 'PR Number',
				name: 'prNumber',
				type: 'number',
				displayOptions: {
					show: {
						service: ['forgejo'],
						operation: ['get_diff', 'merge_pr'],
					},
				},
				default: 0,
				description: 'Pull request number',
				required: true,
			},
			{
				displayName: 'Merge Method',
				name: 'mergeMethod',
				type: 'options',
				displayOptions: {
					show: {
						service: ['forgejo'],
						operation: ['merge_pr'],
					},
				},
				options: [
					{ name: 'Merge Commit', value: 'merge' },
					{ name: 'Rebase', value: 'rebase' },
					{ name: 'Squash', value: 'squash' },
				],
				default: 'squash',
				description: 'How to merge the PR',
			},
			{
				displayName: 'Search Query',
				name: 'repoSearchQuery',
				type: 'string',
				displayOptions: {
					show: {
						service: ['forgejo'],
						operation: ['list_repos'],
					},
				},
				default: '',
				placeholder: 'aisha',
				description: 'Search query for repository names',
			},

			// ═══════════════════════════════════════════════════════════════
			// Appsmith Operations
			// ═══════════════════════════════════════════════════════════════
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { service: ['appsmith'] } },
				options: [
					{
						name: 'List Pages',
						value: 'list_pages',
						description: 'List all pages for an application',
						action: 'List Appsmith pages',
					},
					{
						name: 'Get Page',
						value: 'get_page',
						description: 'Get page details including DSL',
						action: 'Get Appsmith page',
					},
					{
						name: 'Update Page',
						value: 'update_page',
						description: 'Update page layout / DSL',
						action: 'Update Appsmith page',
					},
					{
						name: 'Deploy App',
						value: 'deploy_app',
						description: 'Publish current application state',
						action: 'Deploy Appsmith app',
					},
					{
						name: 'Git Sync',
						value: 'git_sync',
						description: 'Push current app state to connected Git repo',
						action: 'Git sync Appsmith app',
					},
				],
				default: 'list_pages',
			},

			// ═══════════════════════════════════════════════════════════════
			// Appsmith Parameters
			// ═══════════════════════════════════════════════════════════════
			{
				displayName: 'Application ID',
				name: 'applicationId',
				type: 'string',
				displayOptions: {
					show: {
						service: ['appsmith'],
						operation: ['list_pages', 'deploy_app', 'git_sync'],
					},
				},
				default: '',
				placeholder: '64a7b3c...',
				description: 'Appsmith application ID',
				required: true,
			},
			{
				displayName: 'Page ID',
				name: 'pageId',
				type: 'string',
				displayOptions: {
					show: {
						service: ['appsmith'],
						operation: ['get_page', 'update_page'],
					},
				},
				default: '',
				placeholder: '64a7b3c...',
				description: 'Appsmith page ID',
				required: true,
			},
			{
				displayName: 'Page Layout (JSON)',
				name: 'pageLayout',
				type: 'string',
				typeOptions: { rows: 10 },
				displayOptions: {
					show: {
						service: ['appsmith'],
						operation: ['update_page'],
					},
				},
				default: '',
				description: 'Page layout DSL as JSON string',
				required: true,
			},
			{
				displayName: 'Branch Name',
				name: 'appsmithBranch',
				type: 'string',
				displayOptions: {
					show: {
						service: ['appsmith'],
						operation: ['git_sync'],
					},
				},
				default: 'main',
				description: 'Git branch to push to',
			},

			// ═══════════════════════════════════════════════════════════════
			// Health Check Operations
			// ═══════════════════════════════════════════════════════════════
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { service: ['health'] } },
				options: [
					{
						name: 'Check All Services',
						value: 'check_all',
						description: 'Check health of all registered integration services',
						action: 'Check all service health',
					},
					{
						name: 'Check Single Service',
						value: 'check_one',
						description: 'Check health of a specific service',
						action: 'Check single service health',
					},
				],
				default: 'check_all',
			},

			// ═══════════════════════════════════════════════════════════════
			// Common Parameters
			// ═══════════════════════════════════════════════════════════════
			{
				displayName: 'Table ID',
				name: 'tableId',
				type: 'string',
				displayOptions: {
					show: {
						service: ['nocodb'],
						operation: ['get_schema', 'list_records', 'create_record', 'update_record', 'delete_record', 'create_view', 'run_formula'],
					},
				},
				default: '',
				description: 'NocoDB table ID',
				required: true,
			},
			{
				displayName: 'Record ID',
				name: 'recordId',
				type: 'string',
				displayOptions: {
					show: {
						service: ['nocodb'],
						operation: ['update_record', 'delete_record'],
					},
				},
				default: '',
				description: 'NocoDB row ID',
				required: true,
			},
			{
				displayName: 'Record Data (JSON)',
				name: 'recordData',
				type: 'json',
				displayOptions: {
					show: {
						service: ['nocodb'],
						operation: ['create_record', 'update_record'],
					},
				},
				default: '{}',
				description: 'Record data as JSON object',
			},
			{
				displayName: 'View Name',
				name: 'viewName',
				type: 'string',
				displayOptions: {
					show: {
						service: ['nocodb'],
						operation: ['create_view'],
					},
				},
				default: '',
				description: 'Name for the new view',
				required: true,
			},
			{
				displayName: 'View Type',
				name: 'viewType',
				type: 'options',
				displayOptions: {
					show: {
						service: ['nocodb'],
						operation: ['create_view'],
					},
				},
				options: [
					{ name: 'Grid', value: 'grid' },
					{ name: 'Form', value: 'form' },
					{ name: 'Gallery', value: 'gallery' },
					{ name: 'Kanban', value: 'kanban' },
				],
				default: 'grid',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				displayOptions: {
					show: {
						service: ['nocodb'],
						operation: ['list_records'],
					},
				},
				default: 25,
				description: 'Maximum number of records to return',
			},
			{
				displayName: 'Offset',
				name: 'offset',
				type: 'number',
				displayOptions: {
					show: {
						service: ['nocodb'],
						operation: ['list_records'],
					},
				},
				default: 0,
				description: 'Number of records to skip',
			},
			{
				displayName: 'Where Filter',
				name: 'where',
				type: 'string',
				displayOptions: {
					show: {
						service: ['nocodb'],
						operation: ['list_records'],
					},
				},
				default: '',
				placeholder: '(status,eq,active)',
				description: 'NocoDB where filter condition',
			},
			{
				displayName: 'Formula Expression',
				name: 'formula',
				type: 'string',
				displayOptions: {
					show: {
						service: ['nocodb'],
						operation: ['run_formula'],
					},
				},
				default: '',
				placeholder: 'COUNT(Id)',
				description: 'NocoDB formula expression',
			},

			// ── Langfuse filter params ──
			{
				displayName: 'Trace Name Filter',
				name: 'traceName',
				type: 'string',
				displayOptions: {
					show: {
						service: ['langfuse'],
						operation: ['get_traces', 'get_generations'],
					},
				},
				default: '',
				description: 'Filter by trace name (optional)',
			},
			{
				displayName: 'Limit',
				name: 'langfuseLimit',
				type: 'number',
				displayOptions: {
					show: {
						service: ['langfuse'],
					},
				},
				default: 50,
				description: 'Maximum number of items to return',
			},
			{
				displayName: 'Trace ID',
				name: 'traceId',
				type: 'string',
				displayOptions: {
					show: {
						service: ['langfuse'],
						operation: ['create_score'],
					},
				},
				default: '',
				description: 'Trace ID to score',
				required: true,
			},
			{
				displayName: 'Score Name',
				name: 'scoreName',
				type: 'string',
				displayOptions: {
					show: {
						service: ['langfuse'],
						operation: ['create_score'],
					},
				},
				default: 'quality',
				description: 'Name of the score metric',
				required: true,
			},
			{
				displayName: 'Score Value',
				name: 'scoreValue',
				type: 'number',
				displayOptions: {
					show: {
						service: ['langfuse'],
						operation: ['create_score'],
					},
				},
				default: 1,
				description: 'Score value (0-1 recommended)',
				required: true,
			},

			// ── Health check params ──
			{
				displayName: 'Service Name',
				name: 'serviceName',
				type: 'string',
				displayOptions: {
					show: {
						service: ['health'],
						operation: ['check_one'],
					},
				},
				default: '',
				placeholder: 'nocodb',
				description: 'Service name to check (nocodb, langfuse, n8n)',
				required: true,
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const service = this.getNodeParameter('service', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				let result: Record<string, unknown>;

				if (service === 'nocodb') {
					result = await executeNocoDBOps(this, i, operation);
				} else if (service === 'langfuse') {
					result = await executeLangfuseOps(this, i, operation);
				} else if (service === 'forgejo') {
					result = await executeForgejoOps(this, i, operation);
				} else if (service === 'appsmith') {
					result = await executeAppsmithOps(this, i, operation);
				} else if (service === 'health') {
					result = await executeHealthCheckOps(this, i, operation);
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown service: ${service}`, { itemIndex: i });
				}

				returnData.push({ json: result as IDataObject, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: error instanceof Error ? error.message : String(error),
							service: this.getNodeParameter('service', i, 'unknown') as string,
							operation: this.getNodeParameter('operation', i, 'unknown') as string,
						},
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Standalone operation handlers (called from execute with IExecuteFunctions ctx)
// ═══════════════════════════════════════════════════════════════════════════════

async function executeNocoDBOps(
	ctx: IExecuteFunctions,
	itemIndex: number,
	operation: string,
): Promise<Record<string, unknown>> {
	const credentials = await ctx.getCredentials('aishaNocoDbApi', itemIndex);
	const baseUrl = requireCredString(credentials, 'baseUrl', ctx.getNode()).replace(/\/$/, '');
	const token = requireCredString(credentials, 'apiToken', ctx.getNode());

	const headers: Record<string, string> = {
		'xc-token': token,
		'Content-Type': 'application/json',
	};

	switch (operation) {
		case 'list_tables': {
			const response = await fetchWithTimeout(`${baseUrl}/api/v1/meta/bases`, { headers });
			if (!response.ok) {
				throw new NodeOperationError(
					ctx.getNode(),
					`NocoDB API error: ${response.status} ${await response.text()}`,
					{ itemIndex },
				);
			}
			const data = (await response.json()) as Record<string, unknown>;
			return { success: true, operation, data };
		}

		case 'get_schema': {
			const tableId = ctx.getNodeParameter('tableId', itemIndex) as string;
			const response = await fetchWithTimeout(`${baseUrl}/api/v1/meta/tables/${tableId}`, { headers });
			if (!response.ok) {
				throw new NodeOperationError(
					ctx.getNode(),
					`NocoDB API error: ${response.status}`,
					{ itemIndex },
				);
			}
			const data = (await response.json()) as Record<string, unknown>;
			return { success: true, operation, tableId, data };
		}

		case 'list_records': {
			const tableId = ctx.getNodeParameter('tableId', itemIndex) as string;
			const limit = ctx.getNodeParameter('limit', itemIndex, 25) as number;
			const offset = ctx.getNodeParameter('offset', itemIndex, 0) as number;
			const where = ctx.getNodeParameter('where', itemIndex, '') as string;

			const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
			if (where) params.set('where', where);

			const response = await fetchWithTimeout(
				`${baseUrl}/api/v1/db/data/noco/${tableId}?${params.toString()}`,
				{ headers },
			);
			if (!response.ok) {
				throw new NodeOperationError(
					ctx.getNode(),
					`NocoDB API error: ${response.status}`,
					{ itemIndex },
				);
			}
			const data = (await response.json()) as Record<string, unknown>;
			return { success: true, operation, tableId, data };
		}

		case 'create_record': {
			const tableId = ctx.getNodeParameter('tableId', itemIndex) as string;
			const recordData = ctx.getNodeParameter('recordData', itemIndex) as Record<string, unknown>;

			const response = await fetchWithTimeout(`${baseUrl}/api/v1/db/data/noco/${tableId}`, {
				method: 'POST',
				headers,
				body: JSON.stringify(recordData),
			});
			if (!response.ok) {
				throw new NodeOperationError(
					ctx.getNode(),
					`NocoDB API error: ${response.status}`,
					{ itemIndex },
				);
			}
			const data = (await response.json()) as Record<string, unknown>;
			return { success: true, operation, tableId, data };
		}

		case 'update_record': {
			const tableId = ctx.getNodeParameter('tableId', itemIndex) as string;
			const recordId = ctx.getNodeParameter('recordId', itemIndex) as string;
			const recordData = ctx.getNodeParameter('recordData', itemIndex) as Record<string, unknown>;

			const response = await fetchWithTimeout(`${baseUrl}/api/v1/db/data/noco/${tableId}/${recordId}`, {
				method: 'PATCH',
				headers,
				body: JSON.stringify(recordData),
			});
			if (!response.ok) {
				throw new NodeOperationError(
					ctx.getNode(),
					`NocoDB API error: ${response.status}`,
					{ itemIndex },
				);
			}
			const data = (await response.json()) as Record<string, unknown>;
			return { success: true, operation, tableId, recordId, data };
		}

		case 'delete_record': {
			const tableId = ctx.getNodeParameter('tableId', itemIndex) as string;
			const recordId = ctx.getNodeParameter('recordId', itemIndex) as string;

			const response = await fetchWithTimeout(`${baseUrl}/api/v1/db/data/noco/${tableId}/${recordId}`, {
				method: 'DELETE',
				headers,
			});
			if (!response.ok) {
				throw new NodeOperationError(
					ctx.getNode(),
					`NocoDB API error: ${response.status}`,
					{ itemIndex },
				);
			}
			return { success: true, operation, tableId, recordId };
		}

		case 'create_view': {
			const tableId = ctx.getNodeParameter('tableId', itemIndex) as string;
			const viewName = ctx.getNodeParameter('viewName', itemIndex) as string;
			const viewType = ctx.getNodeParameter('viewType', itemIndex) as string;

			const typeMap: Record<string, number> = { grid: 3, form: 1, gallery: 2, kanban: 5 };
			const response = await fetchWithTimeout(`${baseUrl}/api/v1/meta/tables/${tableId}/views`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ title: viewName, type: typeMap[viewType] ?? 3 }),
			});
			if (!response.ok) {
				throw new NodeOperationError(
					ctx.getNode(),
					`NocoDB API error: ${response.status}`,
					{ itemIndex },
				);
			}
			const data = (await response.json()) as Record<string, unknown>;
			return { success: true, operation, tableId, viewName, viewType, data };
		}

		case 'run_formula': {
			const tableId = ctx.getNodeParameter('tableId', itemIndex) as string;
			const formula = ctx.getNodeParameter('formula', itemIndex) as string;
			// NocoDB doesn't have a direct formula execution endpoint —
			// we use the aggregation endpoint or return the formula for column creation
			return {
				success: true,
				operation,
				tableId,
				formula,
				note: 'Formula column creation: use create_record with formula field definition via NocoDB meta API',
			};
		}

		default:
			throw new NodeOperationError(
				ctx.getNode(),
				`Unknown NocoDB operation: ${operation}`,
				{ itemIndex },
			);
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Langfuse API calls
// ═══════════════════════════════════════════════════════════════════════════════

async function executeLangfuseOps(
	ctx: IExecuteFunctions,
	itemIndex: number,
	operation: string,
): Promise<Record<string, unknown>> {
	const credentials = await ctx.getCredentials('aishaLangfuseApi', itemIndex);
	const host = requireCredString(credentials, 'host', ctx.getNode()).replace(/\/$/, '');
	const publicKey = requireCredString(credentials, 'publicKey', ctx.getNode());
	const secretKey = requireCredString(credentials, 'secretKey', ctx.getNode());

	const authHeader = 'Basic ' + Buffer.from(`${publicKey}:${secretKey}`).toString('base64');
	const headers: Record<string, string> = {
		Authorization: authHeader,
		'Content-Type': 'application/json',
	};

	const limit = ctx.getNodeParameter('langfuseLimit', itemIndex, 50) as number;

	switch (operation) {
		case 'get_traces': {
			const traceName = ctx.getNodeParameter('traceName', itemIndex, '') as string;
			const params = new URLSearchParams({ limit: String(limit) });
			if (traceName) params.set('name', traceName);

			const response = await fetchWithTimeout(`${host}/api/public/traces?${params.toString()}`, { headers });
			if (!response.ok) {
				throw new NodeOperationError(
					ctx.getNode(),
					`Langfuse API error: ${response.status}`,
					{ itemIndex },
				);
			}
			const data = (await response.json()) as Record<string, unknown>;
			return { success: true, operation, data };
		}

		case 'get_sessions': {
			const params = new URLSearchParams({ limit: String(limit) });
			const response = await fetchWithTimeout(`${host}/api/public/sessions?${params.toString()}`, {
				headers,
			});
			if (!response.ok) {
				throw new NodeOperationError(
					ctx.getNode(),
					`Langfuse API error: ${response.status}`,
					{ itemIndex },
				);
			}
			const data = (await response.json()) as Record<string, unknown>;
			return { success: true, operation, data };
		}

		case 'get_metrics': {
			// Use the daily metrics endpoint for aggregated data
			const response = await fetchWithTimeout(`${host}/api/public/metrics/daily`, { headers });
			if (!response.ok) {
				throw new NodeOperationError(
					ctx.getNode(),
					`Langfuse API error: ${response.status}`,
					{ itemIndex },
				);
			}
			const data = (await response.json()) as Record<string, unknown>;
			return { success: true, operation, data };
		}

		case 'create_score': {
			const traceId = ctx.getNodeParameter('traceId', itemIndex) as string;
			const scoreName = ctx.getNodeParameter('scoreName', itemIndex) as string;
			const scoreValue = ctx.getNodeParameter('scoreValue', itemIndex) as number;

			const response = await fetchWithTimeout(`${host}/api/public/scores`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					traceId,
					name: scoreName,
					value: scoreValue,
				}),
			});
			if (!response.ok) {
				throw new NodeOperationError(
					ctx.getNode(),
					`Langfuse API error: ${response.status}`,
					{ itemIndex },
				);
			}
			const data = (await response.json()) as Record<string, unknown>;
			return { success: true, operation, traceId, data };
		}

		case 'get_generations': {
			const traceName = ctx.getNodeParameter('traceName', itemIndex, '') as string;
			const params = new URLSearchParams({ limit: String(limit) });
			if (traceName) params.set('name', traceName);

			const response = await fetchWithTimeout(`${host}/api/public/generations?${params.toString()}`, {
				headers,
			});
			if (!response.ok) {
				throw new NodeOperationError(
					ctx.getNode(),
					`Langfuse API error: ${response.status}`,
					{ itemIndex },
				);
			}
			const data = (await response.json()) as Record<string, unknown>;
			return { success: true, operation, data };
		}

		case 'get_datasets': {
			const params = new URLSearchParams({ limit: String(limit) });
			const response = await fetchWithTimeout(`${host}/api/public/datasets?${params.toString()}`, {
				headers,
			});
			if (!response.ok) {
				throw new NodeOperationError(
					ctx.getNode(),
					`Langfuse API error: ${response.status}`,
					{ itemIndex },
				);
			}
			const data = (await response.json()) as Record<string, unknown>;
			return { success: true, operation, data };
		}

		default:
			throw new NodeOperationError(
				ctx.getNode(),
				`Unknown Langfuse operation: ${operation}`,
				{ itemIndex },
			);
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Health Check
// ═══════════════════════════════════════════════════════════════════════════════

async function executeHealthCheckOps(
	ctx: IExecuteFunctions,
	itemIndex: number,
	operation: string,
): Promise<Record<string, unknown>> {
	const services: Array<{ name: string; url: string; healthPath: string }> = [
		{ name: 'nocodb', url: '', healthPath: '/api/v1/health' },
		{ name: 'langfuse', url: '', healthPath: '/api/public/health' },
		{ name: 'forgejo', url: '', healthPath: '/api/v1/version' },
		{ name: 'appsmith', url: '', healthPath: '/api/v1/users/me' },
		{ name: 'n8n', url: '', healthPath: '/healthz' },
	];

	// Try to get URLs from Supabase integration_services table (if available)
	try {
		const supaCredentials = await ctx.getCredentials('aishaPostgrestApi', itemIndex);
		const supaUrl = requirePostgrestUrl(supaCredentials, ctx.getNode());
		const supaKey = supaCredentials.serviceRoleKey as string;

		if (supaUrl && supaKey) {
			const resp = await fetchWithTimeout(`${supaUrl}/rest/v1/rpc/list_integration_services`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${supaKey}`,
					apikey: supaKey,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ p_active_only: true }),
			});
			if (resp.ok) {
				const rows = (await resp.json()) as Array<{
					service_name: string;
					base_url: string;
				}>;
				for (const row of rows) {
					const svc = services.find((s) => s.name === row.service_name);
					if (svc) svc.url = row.base_url;
				}
			}
		}
	} catch {
		// Supabase credentials not available — fall back to manual URLs
	}

	// Fill missing URLs from credentials
	try {
		const nocoCredentials = await ctx.getCredentials('aishaNocoDbApi', itemIndex);
		const nocoSvc = services.find((s) => s.name === 'nocodb');
		if (nocoSvc && !nocoSvc.url) {
			nocoSvc.url = (nocoCredentials.baseUrl as string).replace(/\/$/, '');
		}
	} catch {
		// credential not configured for this user — optional, skip URL override
	}

	try {
		const lfCredentials = await ctx.getCredentials('aishaLangfuseApi', itemIndex);
		const lfSvc = services.find((s) => s.name === 'langfuse');
		if (lfSvc && !lfSvc.url) {
			lfSvc.url = (lfCredentials.host as string).replace(/\/$/, '');
		}
	} catch {
		// credential not configured for this user — optional, skip URL override
	}

	try {
		const fgCredentials = await ctx.getCredentials('aishaForgejoApi', itemIndex);
		const fgSvc = services.find((s) => s.name === 'forgejo');
		if (fgSvc && !fgSvc.url) {
			fgSvc.url = (fgCredentials.baseUrl as string).replace(/\/$/, '');
		}
	} catch {
		// credential not configured for this user — optional, skip URL override
	}

	try {
		const asCredentials = await ctx.getCredentials('aishaAppsmithApi', itemIndex);
		const asSvc = services.find((s) => s.name === 'appsmith');
		if (asSvc && !asSvc.url) {
			asSvc.url = (asCredentials.baseUrl as string).replace(/\/$/, '');
		}
	} catch {
		// credential not configured for this user — optional, skip URL override
	}

	if (operation === 'check_one') {
		const serviceName = ctx.getNodeParameter('serviceName', itemIndex) as string;
		const svc = services.find((s) => s.name === serviceName);
		if (!svc) {
			throw new NodeOperationError(ctx.getNode(), `Unknown service: ${serviceName}`, {
				itemIndex,
			});
		}
		if (!svc.url) return { service: serviceName, status: 'unknown', error: 'No URL configured' };

		return await checkServiceHealthOps(svc);
	}

	// check_all
	const results: Record<string, unknown>[] = [];
	for (const svc of services) {
		if (!svc.url) {
			results.push({ service: svc.name, status: 'unknown', error: 'No URL configured' });
			continue;
		}
		results.push(await checkServiceHealthOps(svc));
	}

	return { success: true, operation: 'check_all', services: results };
}

async function checkServiceHealthOps(svc: {
	name: string;
	url: string;
	healthPath: string;
}): Promise<Record<string, unknown>> {
	const start = Date.now();
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 5000);

		const response = await fetchWithTimeout(`${svc.url}${svc.healthPath}`, {
			signal: controller.signal,
		});
		clearTimeout(timeout);

		const durationMs = Date.now() - start;
		return {
			service: svc.name,
			status: response.ok ? 'healthy' : 'degraded',
			statusCode: response.status,
			durationMs,
			url: svc.url,
		};
	} catch (error) {
		return {
			service: svc.name,
			status: 'down',
			durationMs: Date.now() - start,
			url: svc.url,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Forgejo Git operations
// ═══════════════════════════════════════════════════════════════════════════════

async function executeForgejoOps(
	ctx: IExecuteFunctions,
	itemIndex: number,
	operation: string,
): Promise<Record<string, unknown>> {
	const credentials = await ctx.getCredentials('aishaForgejoApi', itemIndex);
	const baseUrl = requireCredString(credentials, 'baseUrl', ctx.getNode()).replace(/\/$/, '');
	const apiToken = requireCredString(credentials, 'apiToken', ctx.getNode());
	const apiBase = `${baseUrl}/api/v1`;

	async function forgejoFetch(
		path: string,
		method: string = 'GET',
		body?: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		const opts: RequestInit = {
			method,
			headers: {
				Authorization: `token ${apiToken}`,
				'Content-Type': 'application/json',
				Accept: 'application/json',
			},
		};
		if (body) opts.body = JSON.stringify(body);
		const resp = await fetchWithTimeout(`${apiBase}${path}`, opts);
		const text = await resp.text();
		if (!resp.ok) {
			throw new NodeOperationError(
				ctx.getNode(),
				`Forgejo ${method} ${path} → ${resp.status}: ${text}`,
				{ itemIndex },
			);
		}
		return text ? (JSON.parse(text) as Record<string, unknown>) : { success: true };
	}

	if (operation === 'list_repos') {
		const query = ctx.getNodeParameter('repoSearchQuery', itemIndex, '') as string;
		const qs = query ? `?q=${encodeURIComponent(query)}&limit=50` : '?limit=50';
		const data = await forgejoFetch(`/repos/search${qs}`);
		return { success: true, operation, result: data };
	}

	const owner = ctx.getNodeParameter('repoOwner', itemIndex) as string;
	const repo = ctx.getNodeParameter('repoName', itemIndex) as string;

	if (operation === 'create_branch') {
		const branchName = ctx.getNodeParameter('branchName', itemIndex) as string;
		const baseBranch = ctx.getNodeParameter('baseBranch', itemIndex, 'main') as string;
		const result = await forgejoFetch(`/repos/${owner}/${repo}/branches`, 'POST', {
			new_branch_name: branchName,
			old_branch_name: baseBranch,
		});
		return { success: true, operation, result };
	}

	if (operation === 'commit_file') {
		const branchName = ctx.getNodeParameter('branchName', itemIndex) as string;
		const filePath = ctx.getNodeParameter('filePath', itemIndex) as string;
		const fileContent = ctx.getNodeParameter('fileContent', itemIndex) as string;
		const commitMessage = ctx.getNodeParameter('commitMessage', itemIndex) as string;

		// Check if file exists to decide create vs update
		let sha: string | undefined;
		try {
			const existing = await forgejoFetch(
				`/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(branchName)}`,
			);
			sha = existing.sha as string;
		} catch {
			// File doesn't exist — will create
		}

		const body: Record<string, unknown> = {
			content: Buffer.from(fileContent, 'utf-8').toString('base64'),
			message: commitMessage,
			branch: branchName,
		};
		if (sha) body.sha = sha;

		const method = sha ? 'PUT' : 'POST';
		const result = await forgejoFetch(
			`/repos/${owner}/${repo}/contents/${filePath}`,
			method,
			body,
		);
		return { success: true, operation, result };
	}

	if (operation === 'create_pr') {
		const prTitle = ctx.getNodeParameter('prTitle', itemIndex) as string;
		const prBody = ctx.getNodeParameter('prBody', itemIndex, '') as string;
		const headBranch = ctx.getNodeParameter('headBranch', itemIndex) as string;
		const baseBranch = ctx.getNodeParameter('baseBranch', itemIndex, 'main') as string;
		const result = await forgejoFetch(`/repos/${owner}/${repo}/pulls`, 'POST', {
			title: prTitle,
			body: prBody,
			head: headBranch,
			base: baseBranch,
		});
		return { success: true, operation, result };
	}

	if (operation === 'get_diff') {
		const prNumber = ctx.getNodeParameter('prNumber', itemIndex) as number;
		const result = await forgejoFetch(`/repos/${owner}/${repo}/pulls/${prNumber}/files`);
		return { success: true, operation, result };
	}

	if (operation === 'merge_pr') {
		const prNumber = ctx.getNodeParameter('prNumber', itemIndex) as number;
		const mergeMethod = ctx.getNodeParameter('mergeMethod', itemIndex, 'squash') as string;
		const result = await forgejoFetch(`/repos/${owner}/${repo}/pulls/${prNumber}/merge`, 'POST', {
			Do: mergeMethod,
		});
		return { success: true, operation, result };
	}

	throw new NodeOperationError(ctx.getNode(), `Unknown Forgejo operation: ${operation}`, {
		itemIndex,
	});
}

// ═══════════════════════════════════════════════════════════════════════════════
// Appsmith dashboard operations
// ═══════════════════════════════════════════════════════════════════════════════

async function executeAppsmithOps(
	ctx: IExecuteFunctions,
	itemIndex: number,
	operation: string,
): Promise<Record<string, unknown>> {
	const credentials = await ctx.getCredentials('aishaAppsmithApi', itemIndex);
	const baseUrl = requireCredString(credentials, 'baseUrl', ctx.getNode()).replace(/\/$/, '');
	const apiKey = requireCredString(credentials, 'apiKey', ctx.getNode());
	const apiBase = `${baseUrl}/api/v1`;

	async function appsmithFetch(
		path: string,
		method: string = 'GET',
		body?: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		const opts: RequestInit = {
			method,
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
				Accept: 'application/json',
			},
		};
		if (body) opts.body = JSON.stringify(body);
		const resp = await fetchWithTimeout(`${apiBase}${path}`, opts);
		const text = await resp.text();
		if (!resp.ok) {
			throw new NodeOperationError(
				ctx.getNode(),
				`Appsmith ${method} ${path} → ${resp.status}: ${text}`,
				{ itemIndex },
			);
		}
		return text ? (JSON.parse(text) as Record<string, unknown>) : { success: true };
	}

	if (operation === 'list_pages') {
		const applicationId = ctx.getNodeParameter('applicationId', itemIndex) as string;
		const data = await appsmithFetch(
			`/pages?applicationId=${encodeURIComponent(applicationId)}`,
		);
		return { success: true, operation, result: data };
	}

	if (operation === 'get_page') {
		const pageId = ctx.getNodeParameter('pageId', itemIndex) as string;
		const data = await appsmithFetch(`/pages/${pageId}`);
		return { success: true, operation, result: data };
	}

	if (operation === 'update_page') {
		const pageId = ctx.getNodeParameter('pageId', itemIndex) as string;
		const pageLayout = ctx.getNodeParameter('pageLayout', itemIndex) as string;
		const layoutObj = JSON.parse(pageLayout) as Record<string, unknown>;
		const data = await appsmithFetch(`/layouts/${pageId}`, 'PUT', layoutObj);
		return { success: true, operation, result: data };
	}

	if (operation === 'deploy_app') {
		const applicationId = ctx.getNodeParameter('applicationId', itemIndex) as string;
		const data = await appsmithFetch(`/applications/deploy/${applicationId}`, 'POST');
		return { success: true, operation, result: data };
	}

	if (operation === 'git_sync') {
		const applicationId = ctx.getNodeParameter('applicationId', itemIndex) as string;
		const branch = ctx.getNodeParameter('appsmithBranch', itemIndex, 'main') as string;
		const data = await appsmithFetch(`/git/push/${applicationId}`, 'POST', {
			branchName: branch,
		});
		return { success: true, operation, result: data };
	}

	throw new NodeOperationError(ctx.getNode(), `Unknown Appsmith operation: ${operation}`, {
		itemIndex,
	});
}
