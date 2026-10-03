import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { requireCredString, requirePostgrestUrl } from '../_shared/credentials';
import { fetchWithTimeout } from '../_shared/fetchWithTimeout';

/**
 * Aisha Audit Node — Write structured audit journal entries.
 *
 * Provides a dedicated node for writing to `audit_journal` via the
 * `write_audit_journal` RPC function. Enforces the unified audit pattern:
 * - Structured action types
 * - Area tagging (auth, sensitive, admin, n8n, delivery)
 * - Severity levels
 * - Safe metadata (no PII in logs)
 *
 * This node is used by all Aisha workflows for traceability and SOC 2 compliance.
 */
export class AishaAudit implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AISHA Audit',
		name: 'aishaAudit',
		icon: 'file:../AishaRpc/aisha.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{ $parameter["action"] }}',
		description: 'Write structured entries to the Aisha audit journal (SOC 2 compliant)',
		defaults: {
			name: 'Audit Log',
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
			// ── Action ──
			{
				displayName: 'Action',
				name: 'action',
				type: 'options',
				options: [
					{ name: 'Agent Invocation', value: 'AGENT_INVOKED' },
					{ name: 'Agent Response', value: 'AGENT_RESPONSE' },
					{ name: 'Compliance Check', value: 'COMPLIANCE_CHECK' },
					{ name: 'Compliance Fail', value: 'COMPLIANCE_FAIL' },
					{ name: 'Compliance Pass', value: 'COMPLIANCE_PASS' },
					{ name: 'Delivery Transition', value: 'DELIVERY_TRANSITION' },
					{ name: 'Escalation', value: 'ESCALATION' },
					{ name: 'Knowledge Read', value: 'KNOWLEDGE_READ' },
					{ name: 'Model Route', value: 'MODEL_ROUTE' },
					{ name: 'Node Factory: Generate', value: 'NODE_FACTORY_GENERATE' },
					{ name: 'Node Factory: Deploy', value: 'NODE_FACTORY_DEPLOY' },
					{ name: 'Nightly Audit', value: 'NIGHTLY_AUDIT' },
					{ name: 'PR Gate', value: 'PR_GATE' },
					{ name: 'Workflow Execution', value: 'WORKFLOW_EXECUTION' },
					{ name: 'Custom', value: 'CUSTOM' },
				],
				default: 'WORKFLOW_EXECUTION',
				required: true,
				description: 'Type of auditable action',
			},
			// ── Custom action name ──
			{
				displayName: 'Custom Action',
				name: 'customAction',
				type: 'string',
				displayOptions: { show: { action: ['CUSTOM'] } },
				default: '',
				required: true,
				description: 'Custom action identifier',
			},
			// ── Area ──
			{
				displayName: 'Area',
				name: 'area',
				type: 'options',
				options: [
					{ name: 'Auth', value: 'auth' },
					{ name: 'Delivery', value: 'delivery' },
					{ name: 'Knowledge', value: 'knowledge' },
					{ name: 'N8N Automation', value: 'n8n' },
					{ name: 'Orchestration', value: 'orchestration' },
					{ name: 'Admin', value: 'admin' },
					{ name: 'Sensitive', value: 'sensitive' },
				],
				default: 'n8n',
				description: 'Audit area for categorization',
			},
			// ── Severity ──
			{
				displayName: 'Severity',
				name: 'severity',
				type: 'options',
				options: [
					{ name: 'Info', value: 'info' },
					{ name: 'Warning', value: 'warning' },
					{ name: 'Error', value: 'error' },
					{ name: 'Critical', value: 'critical' },
				],
				default: 'info',
				description: 'Severity level of the audit entry',
			},
			// ── Metadata (JSON) ──
			{
				displayName: 'Metadata',
				name: 'metadata',
				type: 'json',
				default: '{}',
				description: 'Additional metadata — NEVER include PII (emails, names, health data). Only IDs and operational data.',
			},
			// ── Entity Reference ──
			{
				displayName: 'Entity Type',
				name: 'entityType',
				type: 'string',
				default: '',
				placeholder: 'story, pr, workflow, agent',
				description: 'Type of entity this audit entry relates to',
			},
			{
				displayName: 'Entity ID',
				name: 'entityId',
				type: 'string',
				default: '',
				placeholder: '={{ $json.story_id }}',
				description: 'ID of the entity (UUID or identifier)',
			},
			// ── User Override ──
			{
				displayName: 'User ID Override',
				name: 'userId',
				type: 'string',
				default: '',
				placeholder: 'system/aisha-dirigent',
				description: 'Override user_id — defaults to "system/n8n-automation" for automated flows',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const credentials = await this.getCredentials('aishaPostgrestApi');

		const supabaseUrl = requirePostgrestUrl(credentials, this.getNode()).replace(/\/$/, '');
		const apiKey = requireCredString(credentials, 'serviceRoleKey', this.getNode());

		for (let i = 0; i < items.length; i++) {
			try {
				const action = this.getNodeParameter('action', i) as string;
				const customAction = action === 'CUSTOM'
					? this.getNodeParameter('customAction', i) as string
					: undefined;
				const area = this.getNodeParameter('area', i) as string;
				const severity = this.getNodeParameter('severity', i) as string;
				const metadataStr = this.getNodeParameter('metadata', i) as string;
				const entityType = this.getNodeParameter('entityType', i) as string;
				const entityId = this.getNodeParameter('entityId', i) as string;
				const userId = this.getNodeParameter('userId', i) as string;

				let metadata: Record<string, unknown>;
				try {
					const parsed = typeof metadataStr === 'string' ? JSON.parse(metadataStr) : metadataStr;
					metadata = parsed as Record<string, unknown>;
				} catch (parseErr) {
					console.warn('[AishaAudit] metadata JSON parse failed, defaulting to {}:', parseErr);
					metadata = {};
				}

				// Build details object (operational metadata, no PII)
				const details: Record<string, unknown> = {
					source: 'n8n-nodes-aisha',
					node_name: this.getNode().name,
					workflow_id: this.getWorkflow().id,
					workflow_name: this.getWorkflow().name,
					...metadata,
				};

				const rpcBody = {
					p_action_type: customAction ?? action,
					p_area: area || 'system',
					p_details: details,
					p_entity_id: entityId || null,
					p_entity_type: entityType || 'unknown',
					p_severity: severity || 'info',
					p_summary: `${customAction ?? action} from n8n workflow ${this.getWorkflow().name}`,
					p_tags: ['n8n', 'automation'],
					p_user_id: userId && userId !== 'system/n8n-automation' ? userId : null,
				};

				const response = await fetchWithTimeout(`${supabaseUrl}/rest/v1/rpc/write_audit_journal`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'apikey': apiKey,
						'Authorization': `Bearer ${apiKey}`,
						'Prefer': 'return=representation',
					},
					body: JSON.stringify(rpcBody),
				});

				if (!response.ok) {
					const errorText = await response.text();
					throw new NodeOperationError(
						this.getNode(),
						`Audit write failed via write_audit_journal RPC: ${errorText}`,
						{ itemIndex: i },
					);
				}

				const data = await response.json();
				returnData.push({ json: { success: true, audit_id: String(data ?? ''), method: 'rpc' } });
			} catch (error) {
				if (this.continueOnFail()) {
					const err = error as Error;
					returnData.push({
						json: { error: err.message, success: false },
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
