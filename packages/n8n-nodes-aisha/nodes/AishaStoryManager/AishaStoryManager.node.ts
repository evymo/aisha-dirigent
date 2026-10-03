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
 * Aisha Story Manager Node — Delivery lifecycle management.
 *
 * Provides a full story lifecycle interface:
 * - Status transitions (with validation via allowed_transitions)
 * - Environment management (staging, production, preview)
 * - Timeline inspection
 * - Ruleset creation and compliance check
 *
 * Integrates with AISHA's delivery state machine:
 * backlog → in_progress → in_review → qa → done (with stuck/blocked side-states)
 */
export class AishaStoryManager implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AISHA Story Manager',
		name: 'aishaStoryManager',
		icon: 'file:../AishaRpc/aisha.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] }}',
		description: 'Manage delivery lifecycle — transitions, environments, timelines, compliance',
		defaults: {
			name: 'Story Manager',
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
					{
						name: 'Get Context',
						value: 'getContext',
						description: 'Get full delivery context for a story',
						action: 'Get story context',
					},
					{
						name: 'Transition Status',
						value: 'transitionStatus',
						description: 'Move story to a new delivery status',
						action: 'Transition story status',
					},
					{
						name: 'Get Allowed Transitions',
						value: 'getAllowedTransitions',
						description: 'Get available next states for a story',
						action: 'Get allowed transitions',
					},
					{
						name: 'Get Timeline',
						value: 'getTimeline',
						description: 'Get transition history for a story',
						action: 'Get delivery timeline',
					},
					{
						name: 'Manage Environment',
						value: 'manageEnvironment',
						description: 'Create or update a story environment (staging, production)',
						action: 'Manage story environment',
					},
					{
						name: 'Get Environments',
						value: 'getEnvironments',
						description: 'List all environments for a story',
						action: 'Get story environments',
					},
					{
						name: 'Create Ruleset',
						value: 'createRuleset',
						description: 'Pin compliance rules to a story with fingerprint',
						action: 'Create story ruleset',
					},
					{
						name: 'Estimate Effort',
						value: 'estimateEffort',
						description: 'Get AI-powered effort estimation',
						action: 'Estimate effort',
					},
				],
				default: 'getContext',
			},
			// ── Story ID (all operations) ──
			{
				displayName: 'Story ID',
				name: 'storyId',
				type: 'string',
				default: '',
				placeholder: '={{ $json.story_id }}',
				description: 'UUID of the story',
				required: true,
			},
			// ── Transition-specific fields ──
			{
				displayName: 'Target Status',
				name: 'targetStatus',
				type: 'options',
				displayOptions: { show: { operation: ['transitionStatus'] } },
				options: [
					{ name: 'Backlog', value: 'backlog' },
					{ name: 'In Progress', value: 'in_progress' },
					{ name: 'In Review', value: 'in_review' },
					{ name: 'QA', value: 'qa' },
					{ name: 'Done', value: 'done' },
					{ name: 'Blocked', value: 'blocked' },
					{ name: 'Stuck', value: 'stuck' },
				],
				default: 'in_progress',
				required: true,
			},
			{
				displayName: 'Transition Reason',
				name: 'reason',
				type: 'string',
				displayOptions: { show: { operation: ['transitionStatus'] } },
				default: '',
				placeholder: 'Automated by Aisha Delivery Agent',
				description: 'Reason for the transition (logged in timeline)',
			},
			// ── Environment fields ──
			{
				displayName: 'Environment Name',
				name: 'envName',
				type: 'options',
				displayOptions: { show: { operation: ['manageEnvironment'] } },
				options: [
					{ name: 'Staging', value: 'staging' },
					{ name: 'Production', value: 'production' },
					{ name: 'Preview', value: 'preview' },
					{ name: 'Development', value: 'development' },
				],
				default: 'staging',
				required: true,
			},
			{
				displayName: 'Environment Config',
				name: 'envConfig',
				type: 'json',
				displayOptions: { show: { operation: ['manageEnvironment'] } },
				default: '{}',
				placeholder: '{"url": "https://staging.example.com", "branch": "feature/x"}',
				description: 'Environment configuration as JSON',
			},
			// ── Ruleset fields ──
			{
				displayName: 'Rule IDs',
				name: 'ruleIds',
				type: 'string',
				displayOptions: { show: { operation: ['createRuleset'] } },
				default: '',
				placeholder: 'rule-uuid-1, rule-uuid-2',
				description: 'Comma-separated UUIDs of rules to pin',
			},
			// ── Effort description ──
			{
				displayName: 'Task Description',
				name: 'taskDescription',
				type: 'string',
				displayOptions: { show: { operation: ['estimateEffort'] } },
				default: '',
				placeholder: 'Implement new RLS policy for partner dashboard',
				description: 'Description of the task to estimate',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const credentials = await this.getCredentials('aishaPostgrestApi');

		const supabaseUrl = requirePostgrestUrl(credentials, this.getNode()).replace(/\/$/, '');
		const apiKey = requireCredString(credentials, 'serviceRoleKey', this.getNode());

		const callRpc = async (funcName: string, params: Record<string, unknown>): Promise<unknown> => {
			const response = await fetchWithTimeout(`${supabaseUrl}/rest/v1/rpc/${funcName}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'apikey': apiKey,
					'Authorization': `Bearer ${apiKey}`,
				},
				body: JSON.stringify(params),
			});

			if (!response.ok) {
				const errBody = await response.text();
				throw new Error(`RPC ${funcName} failed [${response.status}]: ${errBody}`);
			}

			const ct = response.headers.get('content-type') ?? '';
			if (ct.includes('json')) {
				return response.json();
			}
			return response.text();
		};

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const storyId = this.getNodeParameter('storyId', i) as string;

				let result: unknown;

				switch (operation) {
					case 'getContext':
						result = await callRpc('mcp_get_story_context', { p_story_id: storyId });
						break;

					case 'transitionStatus': {
						const targetStatus = this.getNodeParameter('targetStatus', i) as string;
						const reason = this.getNodeParameter('reason', i, '') as string;
						result = await callRpc('transition_story_delivery_status', {
							p_metadata: {},
							p_new_status: targetStatus,
							p_story_id: storyId,
							p_trigger_source: reason || 'n8n-automation',
						});
						break;
					}

					case 'getAllowedTransitions':
						result = await callRpc('get_allowed_transitions', { p_story_id: storyId });
						break;

					case 'getTimeline':
						result = await callRpc('get_delivery_timeline', { p_story_id: storyId });
						break;

					case 'manageEnvironment': {
						const envName = this.getNodeParameter('envName', i) as string;
						const envConfigStr = this.getNodeParameter('envConfig', i) as string;
						const envConfig = typeof envConfigStr === 'string' ? JSON.parse(envConfigStr) : envConfigStr;
						const configObj = typeof envConfig === 'object' && envConfig !== null ? envConfig as Record<string, unknown> : {};
						result = await callRpc('upsert_story_environment', {
							p_branch: (configObj.branch as string) || null,
							p_config: configObj,
							p_deploy_id: (configObj.deploy_id as string) || null,
							p_deploy_provider: (configObj.deploy_provider as string) || 'coolify',
							p_deploy_status: (configObj.deploy_status as string) || 'pending',
							p_environment: envName,
							p_story_id: storyId,
							p_url: (configObj.url as string) || null,
						});
						break;
					}

					case 'getEnvironments':
						result = await callRpc('get_story_environments', { p_story_id: storyId });
						break;

					case 'createRuleset': {
						const ruleIdsStr = this.getNodeParameter('ruleIds', i) as string;
						const ruleIds = ruleIdsStr.split(',').map(id => id.trim()).filter(Boolean);
						result = await callRpc('create_story_ruleset', {
							p_rule_ids: ruleIds,
							p_story_id: storyId,
						});
						break;
					}

					case 'estimateEffort': {
						const taskDescription = this.getNodeParameter('taskDescription', i) as string;
						result = await callRpc('estimate_effort', {
							p_affected_files: [],
							p_complexity_factors: {},
							p_session_id: storyId,
							p_task_description: taskDescription,
						});
						break;
					}

					default:
						throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, { itemIndex: i });
				}

				if (Array.isArray(result)) {
					for (const item of result) {
						returnData.push({ json: item as IDataObject });
					}
				} else {
					returnData.push({
						json: (typeof result === 'object' && result !== null
							? result
							: { result }) as IDataObject,
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					const err = error as Error;
					returnData.push({
						json: { error: err.message },
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
