import type {
	IPollFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { requireCredString, requirePostgrestUrl } from '../_shared/credentials';

/**
 * Aisha Trigger Node — poll-based trigger for Aisha platform events.
 *
 * Polls Supabase RPC endpoints at configured intervals to detect:
 * - New or changed stories (delivery)
 * - Compliance results (quality gate)
 * - Escalations requiring Dirigent attention
 * - Audit anomalies
 * - New agent registrations
 * - Pending self-orchestration requests
 *
 * This replaces scheduled triggers + filter chains with a single
 * declarative node that understands Aisha event semantics.
 */
export class AishaTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AISHA Trigger',
		name: 'aishaTrigger',
		icon: 'file:../AishaRpc/aisha.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{ $parameter["eventType"] }}',
		description: 'Trigger workflows on Aisha platform events (stories, compliance, escalation, audit)',
		defaults: {
			name: 'AISHA Trigger',
		},
		polling: true,
		inputs: [],
		outputs: ['main'],
		credentials: [
			{
				name: 'aishaPostgrestApi',
				required: true,
			},
		],
		properties: [
			// ── Event Type ──
			{
				displayName: 'Event Type',
				name: 'eventType',
				type: 'options',
				options: [
					{
						name: 'Story Created',
						value: 'story_created',
						description: 'New story (task/PR/issue) was created',
					},
					{
						name: 'Story Status Changed',
						value: 'story_status_changed',
						description: 'Story transitioned to a different status',
					},
					{
						name: 'Compliance Check Result',
						value: 'compliance_result',
						description: 'Compliance or quality gate check completed',
					},
					{
						name: 'Escalation Raised',
						value: 'escalation',
						description: 'Issue escalated — requires Dirigent attention',
					},
					{
						name: 'Audit Anomaly',
						value: 'audit_anomaly',
						description: 'Suspicious or anomalous audit journal entry detected',
					},
					{
						name: 'Node Factory Request',
						value: 'node_factory_request',
						description: 'New self-orchestration request — Aisha wants to create a node',
					},
					{
						name: 'Agent Registered',
						value: 'agent_registered',
						description: 'New agent was registered in agent_catalog',
					},
					{
						name: 'Custom RPC Poll',
						value: 'custom_rpc',
						description: 'Poll any RPC function and trigger on new results',
					},
				],
				default: 'story_created',
				noDataExpression: true,
			},
			// ── Filters ──
			{
				displayName: 'Status Filter',
				name: 'statusFilter',
				type: 'string',
				displayOptions: {
					show: { eventType: ['story_status_changed'] },
				},
				default: '',
				placeholder: 'in_review,qa,blocked',
				description: 'Comma-separated list of target statuses to trigger on (empty = all)',
			},
			{
				displayName: 'Severity Filter',
				name: 'severityFilter',
				type: 'options',
				displayOptions: {
					show: { eventType: ['audit_anomaly', 'escalation'] },
				},
				options: [
					{ name: 'All', value: 'all' },
					{ name: 'Warning+', value: 'warning' },
					{ name: 'Error Only', value: 'error' },
				],
				default: 'warning',
			},
			// ── Custom RPC ──
			{
				displayName: 'RPC Function',
				name: 'customRpcFunction',
				type: 'string',
				displayOptions: { show: { eventType: ['custom_rpc'] } },
				default: '',
				placeholder: 'get_pending_items',
				description: 'Name of the Supabase RPC function to poll',
			},
			{
				displayName: 'RPC Parameters (JSON)',
				name: 'customRpcParams',
				type: 'string',
				displayOptions: { show: { eventType: ['custom_rpc'] } },
				default: '{}',
				description: 'JSON object of parameters to pass to the RPC function',
			},
			// ── Deduplication ──
			{
				displayName: 'Dedup Field',
				name: 'dedupField',
				type: 'string',
				default: 'id',
				description: 'Field name used to deduplicate events (prevent re-triggering)',
			},
			{
				displayName: 'Max Events Per Poll',
				name: 'maxEvents',
				type: 'number',
				default: 25,
				typeOptions: { minValue: 1, maxValue: 100 },
			},
		],
	};

	/**
	 * Map event types to RPC function calls.
	 */
	private static getEventRpcConfig(eventType: string): {
		rpcFunction: string;
		params: Record<string, unknown>;
		timestampField: string;
	} {
		const configs: Record<string, { rpcFunction: string; params: Record<string, unknown>; timestampField: string }> = {
			story_created: {
				rpcFunction: 'get_delivery_context',
				params: { p_include_recent: true },
				timestampField: 'created_at',
			},
			story_status_changed: {
				rpcFunction: 'get_delivery_timeline',
				params: {},
				timestampField: 'changed_at',
			},
			compliance_result: {
				rpcFunction: 'get_compliance_results',
				params: { p_limit: 50 },
				timestampField: 'checked_at',
			},
			escalation: {
				rpcFunction: 'get_escalations',
				params: { p_status: 'open' },
				timestampField: 'created_at',
			},
			audit_anomaly: {
				rpcFunction: 'get_audit_anomalies',
				params: {},
				timestampField: 'created_at',
			},
			node_factory_request: {
				rpcFunction: 'get_node_factory_requests',
				params: { p_status: 'pending' },
				timestampField: 'requested_at',
			},
			agent_registered: {
				rpcFunction: 'get_agent_catalog',
				params: {},
				timestampField: 'registered_at',
			},
		};

		return configs[eventType] ?? {
			rpcFunction: 'get_delivery_context',
			params: {},
			timestampField: 'created_at',
		};
	}

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const eventType = this.getNodeParameter('eventType') as string;
		const dedupField = this.getNodeParameter('dedupField') as string;
		const maxEvents = this.getNodeParameter('maxEvents') as number;

		const credentials = await this.getCredentials('aishaPostgrestApi');
		const supabaseUrl = requirePostgrestUrl(credentials, this.getNode()).replace(/\/$/, '');
		const apiKey = requireCredString(credentials, 'serviceRoleKey', this.getNode());

		// Determine RPC config
		let rpcFunction: string;
		let rpcParams: Record<string, unknown>;

		if (eventType === 'custom_rpc') {
			rpcFunction = this.getNodeParameter('customRpcFunction') as string;
			const rawParams = this.getNodeParameter('customRpcParams') as string;
			try {
				rpcParams = JSON.parse(rawParams) as Record<string, unknown>;
			} catch (parseErr) {
				console.warn('[AishaTrigger] custom RPC params JSON parse failed, defaulting to {}:', parseErr);
				rpcParams = {};
			}
		} else {
			const config = AishaTrigger.getEventRpcConfig(eventType);
			rpcFunction = config.rpcFunction;
			rpcParams = { ...config.params };
		}

		// Add limit and since-last-poll timestamp if supported
		const lastPollDate = this.getMode() === 'manual'
			? new Date(0).toISOString()
			: ((this.getWorkflowStaticData('node') as { lastPollDate?: string }).lastPollDate ?? new Date(0).toISOString());

		rpcParams.p_since = lastPollDate;
		rpcParams.p_limit = maxEvents;

		// Call Supabase RPC
		let results: Array<Record<string, unknown>> = [];
		try {
			const resp = await this.helpers.httpRequest({
				method: 'POST',
				url: `${supabaseUrl}/rest/v1/rpc/${rpcFunction}`,
				headers: {
					'Content-Type': 'application/json',
					'apikey': apiKey,
					'Authorization': `Bearer ${apiKey}`,
					'Prefer': 'return=representation',
				},
				body: rpcParams,
				returnFullResponse: false,
			});

			results = Array.isArray(resp) ? resp as Array<Record<string, unknown>> : ([resp] as Array<Record<string, unknown>>);
		} catch (rpcErr) {
			// RPC might not exist yet (older Supabase schema) — log + return empty
			// so polling stays soft-failing instead of crashing the trigger node.
			console.warn(`[AishaTrigger] RPC ${rpcFunction} unavailable, returning null:`, rpcErr);
			return null;
		}

		if (!results || results.length === 0) {
			return null;
		}

		// Apply filters
		if (eventType === 'story_status_changed') {
			const statusFilterRaw = this.getNodeParameter('statusFilter', '') as string;
			if (statusFilterRaw) {
				const allowedStatuses = statusFilterRaw.split(',').map((s: string) => s.trim().toLowerCase());
				results = results.filter((r) => {
					const status = String(r.status ?? r.new_status ?? '').toLowerCase();
					return allowedStatuses.includes(status);
				});
			}
		}

		if (eventType === 'audit_anomaly' || eventType === 'escalation') {
			const severityFilter = this.getNodeParameter('severityFilter', 'all') as string;
			if (severityFilter !== 'all') {
				const severityOrder = ['info', 'warning', 'error'];
				const minIdx = severityOrder.indexOf(severityFilter);
				results = results.filter((r) => {
					const sev = String(r.severity ?? 'info').toLowerCase();
					return severityOrder.indexOf(sev) >= minIdx;
				});
			}
		}

		// Dedup — store seen IDs
		const staticData = this.getWorkflowStaticData('node') as { seenIds?: string[]; lastPollDate?: string };
		const seenIds = new Set<string>(staticData.seenIds ?? []);
		const newResults = results.filter((r) => {
			const id = String(r[dedupField] ?? '');
			if (!id || seenIds.has(id)) return false;
			return true;
		});

		if (newResults.length === 0) {
			// Update poll date even if no new events
			staticData.lastPollDate = new Date().toISOString();
			return null;
		}

		// Track dedup IDs (keep only last 500 to prevent unbounded growth)
		const newIds = newResults.map((r) => String(r[dedupField] ?? ''));
		const allIds = [...(staticData.seenIds ?? []), ...newIds];
		staticData.seenIds = allIds.slice(-500);
		staticData.lastPollDate = new Date().toISOString();

		// Format output
		const outputItems: INodeExecutionData[] = newResults.map((event, index) => ({
			json: {
				...event,
				_trigger: {
					eventType,
					detectedAt: new Date().toISOString(),
					pollIndex: index,
				},
			},
		}));

		return [outputItems];
	}
}
