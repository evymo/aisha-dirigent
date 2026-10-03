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
 * Aisha RPC Node — Direct Supabase RPC invocation.
 *
 * Replaces manual httpRequest nodes with a type-safe, audited RPC caller.
 * Supports all 26+ MCP-registered functions plus any custom Supabase RPC.
 *
 * Features:
 * - Auto-constructed URL: `{supabaseUrl}/rest/v1/rpc/{functionName}`
 * - Automatic auth header injection (service_role or anon key)
 * - JSON parameter serialization
 * - Built-in error parsing (Supabase PostgREST error format)
 * - Optional audit trail metadata attachment
 * - Timeout & retry configuration
 */
export class AishaRpc implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AISHA RPC',
		name: 'aishaRpc',
		icon: 'file:aisha.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["functionName"] }}',
		description: 'Invoke Supabase RPC functions with type-safe parameters and audit integration',
		defaults: {
			name: 'AISHA RPC',
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
			// ── Function Category ──
			{
				displayName: 'Category',
				name: 'category',
				type: 'options',
				options: [
					{ name: 'Knowledge', value: 'knowledge' },
					{ name: 'Delivery', value: 'delivery' },
					{ name: 'Orchestration', value: 'orchestration' },
					{ name: 'Dirigent', value: 'dirigent' },
					{ name: 'Compliance', value: 'compliance' },
					{ name: 'Custom', value: 'custom' },
				],
				default: 'knowledge',
				description: 'Category of the RPC function — filters the function list',
			},
			// ── Knowledge functions ──
			{
				displayName: 'Function',
				name: 'functionName',
				type: 'options',
				displayOptions: { show: { category: ['knowledge'] } },
				options: [
					{ name: 'Search Knowledge', value: 'mcp_search_knowledge' },
					{ name: 'Search Knowledge V2 (Hybrid)', value: 'mcp_search_knowledge_v2' },
					{ name: 'Get Rule Detail', value: 'mcp_get_rule_detail' },
					{ name: 'Get Knowledge Item', value: 'mcp_get_knowledge_item' },
					{ name: 'Get Knowledge Stats', value: 'mcp_get_knowledge_stats' },
					{ name: 'Get Expertise Areas', value: 'mcp_get_expertise_areas' },
					{ name: 'Match Experts', value: 'mcp_match_experts' },
					{ name: 'Get Agent Knowledge', value: 'mcp_get_agent_knowledge' },
				],
				default: 'mcp_search_knowledge_v2',
				required: true,
			},
			// ── Delivery functions ──
			{
				displayName: 'Function',
				name: 'functionName',
				type: 'options',
				displayOptions: { show: { category: ['delivery'] } },
				options: [
					{ name: 'Get Story Context', value: 'mcp_get_story_context' },
					{ name: 'Transition Delivery Status', value: 'transition_story_delivery_status' },
					{ name: 'Get Delivery Timeline', value: 'get_delivery_timeline' },
					{ name: 'Get Allowed Transitions', value: 'get_allowed_transitions' },
					{ name: 'Upsert Story Environment', value: 'upsert_story_environment' },
					{ name: 'Get Story Environments', value: 'get_story_environments' },
					{ name: 'Create Story Ruleset', value: 'create_story_ruleset' },
				],
				default: 'mcp_get_story_context',
				required: true,
			},
			// ── Orchestration functions ──
			{
				displayName: 'Function',
				name: 'functionName',
				type: 'options',
				displayOptions: { show: { category: ['orchestration'] } },
				options: [
					{ name: 'Route Task', value: 'route_task' },
					{ name: 'Compose Context', value: 'compose_context' },
					{ name: 'Generate Copilot Instructions', value: 'generate_copilot_instructions' },
					{ name: 'Get Compliance Context', value: 'mcp_get_compliance_context' },
				],
				default: 'route_task',
				required: true,
			},
			// ── Dirigent functions ──
			{
				displayName: 'Function',
				name: 'functionName',
				type: 'options',
				displayOptions: { show: { category: ['dirigent'] } },
				options: [
					{ name: 'Estimate Effort', value: 'estimate_effort' },
					{ name: 'Get Agent Knowledge', value: 'mcp_get_agent_knowledge' },
					{ name: 'Get Agent Memories', value: 'mcp_get_agent_memories' },
					{ name: 'Store Agent Memory', value: 'mcp_store_agent_memory' },
					{ name: 'Summarize Agent Memories', value: 'mcp_summarize_agent_memories' },
					{ name: 'Get Agent Tool', value: 'get_agent_tool' },
				],
				default: 'estimate_effort',
				required: true,
			},
			// ── Compliance functions ──
			{
				displayName: 'Function',
				name: 'functionName',
				type: 'options',
				displayOptions: { show: { category: ['compliance'] } },
				options: [
					{ name: 'Get Compliance Context', value: 'mcp_get_compliance_context' },
					{ name: 'Generate Copilot Instructions', value: 'generate_copilot_instructions' },
				],
				default: 'mcp_get_compliance_context',
				required: true,
			},
			// ── Custom function name ──
			{
				displayName: 'Function Name',
				name: 'functionName',
				type: 'string',
				displayOptions: { show: { category: ['custom'] } },
				default: '',
				placeholder: 'my_custom_rpc_function',
				description: 'Name of any Supabase RPC function',
				required: true,
			},
			// ── Parameters ──
			{
				displayName: 'Parameters',
				name: 'rpcParams',
				type: 'json',
				default: '{}',
				placeholder: '{"p_query": "search term", "p_limit": 10}',
				description: 'JSON object with RPC function parameters (key-value pairs)',
			},
			// ── Auth Mode ──
			{
				displayName: 'Auth Mode',
				name: 'authMode',
				type: 'options',
				options: [
					{ name: 'Service Role (bypass RLS)', value: 'service_role' },
					{ name: 'Anon (respect RLS)', value: 'anon' },
				],
				default: 'service_role',
				description: 'Authentication mode — service_role bypasses RLS, anon respects it',
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
					{
						displayName: 'Audit Trail',
						name: 'auditTrail',
						type: 'boolean',
						default: false,
						description: 'Whether to attach audit metadata to the request headers',
					},
					{
						displayName: 'Audit Area',
						name: 'auditArea',
						type: 'string',
						default: 'n8n_automation',
						description: 'Audit area identifier for tracking',
						displayOptions: { show: { auditTrail: [true] } },
					},
					{
						displayName: 'Return Raw Response',
						name: 'rawResponse',
						type: 'boolean',
						default: false,
						description: 'Whether to return the full HTTP response including headers',
					},
					{
						displayName: 'Prefer Header',
						name: 'preferHeader',
						type: 'string',
						default: '',
						placeholder: 'return=representation',
						description: 'PostgREST Prefer header value (e.g., return=representation)',
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
		const authMode = this.getNodeParameter('authMode', 0) as string;
		const apiKey = authMode === 'service_role'
			? requireCredString(credentials, 'serviceRoleKey', this.getNode())
			: requireCredString(credentials, 'anonKey', this.getNode());

		for (let i = 0; i < items.length; i++) {
			try {
				const functionName = this.getNodeParameter('functionName', i) as string;
				const rpcParams = this.getNodeParameter('rpcParams', i) as string;
				const options = this.getNodeParameter('options', i, {}) as {
					timeout?: number;
					auditTrail?: boolean;
					auditArea?: string;
					rawResponse?: boolean;
					preferHeader?: string;
				};

				let params: Record<string, unknown>;
				try {
					params = typeof rpcParams === 'string' ? JSON.parse(rpcParams) : rpcParams;
				} catch {
					throw new NodeOperationError(
						this.getNode(),
						`Invalid JSON in Parameters field: ${rpcParams}`,
						{ itemIndex: i },
					);
				}

				const url = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/${functionName}`;

				const headers: Record<string, string> = {
					'Content-Type': 'application/json',
					'apikey': apiKey,
					'Authorization': `Bearer ${apiKey}`,
				};

				if (options.preferHeader) {
					headers['Prefer'] = options.preferHeader;
				}

				if (options.auditTrail) {
					headers['X-Aisha-Audit-Area'] = options.auditArea ?? 'n8n_automation';
					headers['X-Aisha-Audit-Source'] = 'n8n-nodes-aisha';
					headers['X-Aisha-Node-Name'] = this.getNode().name;
				}

				const controller = new AbortController();
				const timeoutMs = options.timeout ?? 30000;
				const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

				try {
					const response = await fetchWithTimeout(url, {
						method: 'POST',
						headers,
						body: JSON.stringify(params),
						signal: controller.signal,
					});

					clearTimeout(timeoutId);

					const contentType = response.headers.get('content-type') ?? '';
					let responseData: unknown;

					if (contentType.includes('application/json')) {
						responseData = await response.json();
					} else {
						responseData = await response.text();
					}

					if (!response.ok) {
						const errorBody = typeof responseData === 'object' && responseData !== null
							? responseData as Record<string, unknown>
							: { message: responseData };

						throw new NodeOperationError(
							this.getNode(),
							`RPC "${functionName}" failed [${response.status}]: ${errorBody.message ?? errorBody.hint ?? JSON.stringify(errorBody)}`,
							{ itemIndex: i },
						);
					}

					if (options.rawResponse) {
						const responseHeaders: Record<string, string> = {};
						response.headers.forEach((v, k) => { responseHeaders[k] = v; });
						returnData.push({
							json: {
								status: response.status,
								headers: responseHeaders,
								data: responseData as IDataObject,
							},
						});
					} else {
						// Normalize: if array, wrap each item; if object, return as-is
						if (Array.isArray(responseData)) {
							for (const item of responseData) {
								returnData.push({ json: item as IDataObject });
							}
						} else {
							returnData.push({
								json: (typeof responseData === 'object' && responseData !== null
									? responseData
									: { result: responseData }) as IDataObject,
							});
						}
					}
				} catch (error) {
					clearTimeout(timeoutId);
					if (error instanceof NodeOperationError) throw error;
					const err = error as Error;
					if (err.name === 'AbortError') {
						throw new NodeOperationError(
							this.getNode(),
							`RPC "${functionName}" timed out after ${timeoutMs}ms`,
							{ itemIndex: i },
						);
					}
					throw new NodeOperationError(
						this.getNode(),
						`RPC "${functionName}" network error: ${err.message}`,
						{ itemIndex: i },
					);
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
