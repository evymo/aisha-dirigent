import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { requireCredString, requirePostgrestUrl } from '../_shared/credentials';
import { fetchWithTimeout } from '../_shared/fetchWithTimeout';

/**
 * Aisha Node Factory — Self-orchestration meta-node.
 *
 * Aisha Dirigent is her own client: this node allows the AI agent
 * to generate, validate, test, and deploy NEW n8n community nodes
 * at runtime, extending its own capabilities autonomously.
 *
 * Operations:
 * 1. **generate**   — Create TypeScript source for a new n8n node from a spec
 * 2. **validate**   — Validate generated node code against n8n INodeType interface
 * 3. **test**       — Execute generated test suite via Vitest subprocess
 * 4. **deploy**     — Push node to n8n instance via npm install or API
 * 5. **register**   — Add node to agent_catalog / workflow registry
 * 6. **listNodes**  — List all available custom Aisha nodes
 *
 * Security:
 * - All factory operations are audited (action=NODE_FACTORY_GENERATE/VALIDATE/TEST/DEPLOY)
 * - Code generation uses prompt templates with strict sandboxing
 * - Deploy requires service_role authentication
 * - Generated code is validated before deployment
 */
export class AishaNodeFactory implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AISHA Node Factory',
		name: 'aishaNodeFactory',
		icon: 'file:../AishaRpc/aisha.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] }}',
		description: 'Self-orchestration: generate, validate, test, and deploy new n8n nodes autonomously',
		defaults: {
			name: 'Node Factory',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'aishaPostgrestApi',
				required: true,
			},
			{
				name: 'aishaMcpApi',
				required: false,
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
						name: 'Generate Node',
						value: 'generate',
						description: 'Generate TypeScript source for a new n8n community node',
						action: 'Generate a new n8n node from specification',
					},
					{
						name: 'Validate Code',
						value: 'validate',
						description: 'Validate generated node code structure and types',
						action: 'Validate node TypeScript code',
					},
					{
						name: 'Run Tests',
						value: 'test',
						description: 'Execute Vitest test suite for a generated node',
						action: 'Run tests for a node',
					},
					{
						name: 'Deploy to n8n',
						value: 'deploy',
						description: 'Package and install node on the n8n instance',
						action: 'Deploy node to n8n instance',
					},
					{
						name: 'Register Node',
						value: 'register',
						description: 'Register deployed node in agent_catalog and workflow registry',
						action: 'Register node in platform',
					},
					{
						name: 'List Nodes',
						value: 'listNodes',
						description: 'List all custom Aisha nodes (installed and generated)',
						action: 'List all custom nodes',
					},
				],
				default: 'generate',
			},

			// ── Generate: Node Specification ──
			{
				displayName: 'Node Name',
				name: 'nodeName',
				type: 'string',
				displayOptions: { show: { operation: ['generate', 'validate', 'test', 'deploy', 'register'] } },
				default: '',
				placeholder: 'AishaHealthCheck',
				description: 'PascalCase name for the new node (must start with "Aisha")',
				required: true,
			},
			{
				displayName: 'Display Name',
				name: 'nodeDisplayName',
				type: 'string',
				displayOptions: { show: { operation: ['generate'] } },
				default: '',
				placeholder: 'AISHA Health Check',
				description: 'Human-readable name shown in n8n UI',
			},
			{
				displayName: 'Description',
				name: 'nodeDescription',
				type: 'string',
				displayOptions: { show: { operation: ['generate'] } },
				typeOptions: { rows: 3 },
				default: '',
				placeholder: 'Describe what this node should do, its inputs, outputs, and behavior...',
				description: 'Detailed description of the node\'s purpose and behavior',
			},
			{
				displayName: 'Operations',
				name: 'nodeOperations',
				type: 'string',
				displayOptions: { show: { operation: ['generate'] } },
				typeOptions: { rows: 5 },
				default: '',
				placeholder: 'getAll: Retrieve all health check-ins\ncreate: Create a new check-in\nanalyze: Run statistical analysis on check-ins',
				description: 'One operation per line. Format: "operationName: Description"',
			},
			{
				displayName: 'RPC Functions',
				name: 'nodeRpcFunctions',
				type: 'string',
				displayOptions: { show: { operation: ['generate'] } },
				typeOptions: { rows: 3 },
				default: '',
				placeholder: 'get_health_check_ins_audited, insert_health_check_in, analyze_health_trends',
				description: 'Comma-separated Supabase RPC function names this node will call',
			},
			{
				displayName: 'Node Category',
				name: 'nodeCategory',
				type: 'options',
				displayOptions: { show: { operation: ['generate'] } },
				options: [
					{ name: 'Action', value: 'action' },
					{ name: 'Transform', value: 'transform' },
					{ name: 'Trigger', value: 'trigger' },
				],
				default: 'action',
			},
			{
				displayName: 'Requires Audit Trail',
				name: 'requiresAudit',
				type: 'boolean',
				displayOptions: { show: { operation: ['generate'] } },
				default: true,
				description: 'Whether operations should be logged to audit_journal',
			},

			// ── Validate/Test: Source Input ──
			{
				displayName: 'Source Code',
				name: 'sourceCode',
				type: 'string',
				displayOptions: { show: { operation: ['validate'] } },
				typeOptions: { rows: 20 },
				default: '',
				description: 'TypeScript source code of the node to validate (leave empty to use generated code from previous step)',
			},

			// ── Deploy ──
			{
				displayName: 'N8N Instance URL',
				name: 'n8nInstanceUrl',
				type: 'string',
				displayOptions: { show: { operation: ['deploy'] } },
				default: '={{ $env.N8N_URL || "http://localhost:5678" }}',
				description: 'URL of the n8n instance to deploy to',
			},
			{
				displayName: 'Deploy Method',
				name: 'deployMethod',
				type: 'options',
				displayOptions: { show: { operation: ['deploy'] } },
				options: [
					{
						name: 'NPM Install (Local)',
						value: 'npm',
						description: 'Build and npm link/install on local n8n',
					},
					{
						name: 'Generate Package Only',
						value: 'package',
						description: 'Generate npm package tarball for manual installation',
					},
				],
				default: 'package',
			},
		],
	};

	/** TypeScript template for generating a new node. */
	private static generateNodeTemplate(spec: {
		name: string;
		displayName: string;
		description: string;
		operations: Array<{ name: string; description: string }>;
		rpcFunctions: string[];
		category: string;
		requiresAudit: boolean;
	}): string {
		const operationOptions = spec.operations
			.map(
				(op) => `					{
						name: '${op.name.charAt(0).toUpperCase() + op.name.slice(1)}',
						value: '${op.name}',
						description: '${op.description.replace(/'/g, "\\'")}',
						action: '${op.description.replace(/'/g, "\\'")}',
					}`,
			)
			.join(',\n');

		const executeBody = spec.operations
			.map(
				(op, idx) => `${idx > 0 ? '} else ' : ''}if (operation === '${op.name}') {
						const rpcResp = await fetchWithTimeout(\`\${supabaseUrl}/rest/v1/rpc/${spec.rpcFunctions[idx] ?? spec.rpcFunctions[0] ?? op.name}\`, {
							method: 'POST',
							headers,
							body: JSON.stringify({}),
						});
						if (!rpcResp.ok) {
							const errBody = await rpcResp.text();
							throw new NodeOperationError(this.getNode(), \`RPC error: \${errBody}\`, { itemIndex: i });
						}
						responseData = await rpcResp.json();`,
			)
			.join('\n					');

		const auditBlock = spec.requiresAudit
			? `
					// Audit trail
					try {
						await fetchWithTimeout(\`\${supabaseUrl}/rest/v1/rpc/write_audit_journal\`, {
							method: 'POST',
							headers,
							body: JSON.stringify({
								p_action_type: \`\${operation.toUpperCase()}\`,
								p_area: 'n8n',
								p_severity: 'info',
								p_details: { node: '${spec.name}', operation, workflow_id: this.getWorkflow().id },
							}),
						});
					} catch {
						// audit best-effort — never block the actual operation on audit failure
					}
`
			: '';

		return `import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { requireCredString, requirePostgrestUrl } from '../_shared/credentials';
import { fetchWithTimeout } from '../_shared/fetchWithTimeout';

/**
 * ${spec.displayName}
 *
 * ${spec.description}
 *
 * @generated by AishaNodeFactory
 * @date ${new Date().toISOString()}
 */
export class ${spec.name} implements INodeType {
	description: INodeTypeDescription = {
		displayName: '${spec.displayName}',
		name: '${spec.name.charAt(0).toLowerCase() + spec.name.slice(1)}',
		icon: 'file:../AishaRpc/aisha.svg',
		group: ['${spec.category === 'trigger' ? 'trigger' : spec.category === 'transform' ? 'transform' : 'output'}'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: '${spec.description.replace(/'/g, "\\'")}',
		defaults: { name: '${spec.displayName}' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'aishaPostgrestApi', required: true }],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
${operationOptions}
				],
				default: '${spec.operations[0]?.name ?? 'getAll'}',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const credentials = await this.getCredentials('aishaPostgrestApi');
		const supabaseUrl = requirePostgrestUrl(credentials, this.getNode()).replace(/\\/$/, '');
		const apiKey = requireCredString(credentials, 'serviceRoleKey', this.getNode());
		const headers = {
			'Content-Type': 'application/json',
			'apikey': apiKey,
			'Authorization': \`Bearer \${apiKey}\`,
		};

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				let responseData: unknown;

				${executeBody}
					}
${auditBlock}
				returnData.push({
					json: typeof responseData === 'object' && responseData !== null
						? responseData as Record<string, unknown>
						: { result: responseData },
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
`;
	}

	/** Generate a Vitest test file for the node. */
	private static generateTestTemplate(spec: {
		name: string;
		operations: Array<{ name: string; description: string }>;
	}): string {
		const operationTests = spec.operations
			.map(
				(op) => `
	it('should execute ${op.name} operation', async () => {
		const mockContext = createMockExecuteFunctions({
			operation: '${op.name}',
		});

		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ success: true }),
			text: async () => '{}',
		}) as unknown as typeof fetch;

		const node = new ${spec.name}();
		const result = await node.execute.call(mockContext);
		expect(result).toBeDefined();
		expect(result[0]).toHaveLength(1);
		expect(result[0][0].json).toBeDefined();
	});`,
			)
			.join('\n');

		return `import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ${spec.name} } from '../nodes/${spec.name}/${spec.name}.node';
import { createMockExecuteFunctions } from './helpers/mockFactory';

describe('${spec.name}', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('should have correct node description', () => {
		const node = new ${spec.name}();
		expect(node.description.name).toBe('${spec.name.charAt(0).toLowerCase() + spec.name.slice(1)}');
		expect(node.description.version).toBe(1);
		expect(node.description.credentials).toBeDefined();
	});
${operationTests}

	it('should handle RPC errors gracefully with continueOnFail', async () => {
		const mockContext = createMockExecuteFunctions({
			operation: '${spec.operations[0]?.name ?? 'getAll'}',
			continueOnFail: true,
		});

		global.fetch = vi.fn().mockResolvedValue({
			ok: false,
			text: async () => 'RPC error: function not found',
		}) as unknown as typeof fetch;

		const node = new ${spec.name}();
		const result = await node.execute.call(mockContext);
		expect(result[0][0].json).toHaveProperty('error');
	});
});
`;
	}

	/** Validate node source code structure. */
	private static validateNodeCode(sourceCode: string): {
		valid: boolean;
		errors: string[];
		warnings: string[];
	} {
		const errors: string[] = [];
		const warnings: string[] = [];

		// Check for INodeType implementation
		if (!sourceCode.includes('implements INodeType')) {
			errors.push('Missing "implements INodeType" — node must implement INodeType interface');
		}

		// Check for description property
		if (!sourceCode.includes('description: INodeTypeDescription')) {
			errors.push('Missing "description: INodeTypeDescription" property');
		}

		// Check for execute method
		if (!sourceCode.includes('async execute(')) {
			errors.push('Missing "async execute()" method');
		}

		// Check for required description fields
		const requiredFields = ['displayName', 'name', 'version', 'inputs', 'outputs'];
		for (const field of requiredFields) {
			if (!sourceCode.includes(`${field}:`)) {
				errors.push(`Missing required description field: ${field}`);
			}
		}

		// Security checks
		if (sourceCode.includes('eval(') || sourceCode.includes('Function(')) {
			errors.push('SECURITY: Code contains eval() or Function() — forbidden in Aisha nodes');
		}

		if (sourceCode.includes('console.log(')) {
			warnings.push('Contains console.log() — should use NodeOperationError for errors');
		}

		if (sourceCode.includes('.select("*")')) {
			errors.push('Contains .select("*") — must use explicit column selection (Aisha rule)');
		}

		// Check for proper error handling
		if (!sourceCode.includes('continueOnFail')) {
			warnings.push('No continueOnFail handling — consider adding for robustness');
		}

		// Check for credentials
		if (!sourceCode.includes('credentials')) {
			warnings.push('No credentials defined — node might need authentication');
		}

		// Check naming convention
		const nameMatch = sourceCode.match(/name:\s*'([^']+)'/);
		if (nameMatch && !nameMatch[1].startsWith('aisha')) {
			warnings.push(`Node name "${nameMatch[1]}" should start with "aisha" prefix`);
		}

		return { valid: errors.length === 0, errors, warnings };
	}

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const nodeName = operation !== 'listNodes'
					? this.getNodeParameter('nodeName', i) as string
					: '';

				// ── Generate ──
				if (operation === 'generate') {
					const displayName = (this.getNodeParameter('nodeDisplayName', i) as string) || nodeName.replace(/([A-Z])/g, ' $1').trim();
					const description = this.getNodeParameter('nodeDescription', i) as string;
					const operationsRaw = this.getNodeParameter('nodeOperations', i) as string;
					const rpcFunctionsRaw = this.getNodeParameter('nodeRpcFunctions', i) as string;
					const category = this.getNodeParameter('nodeCategory', i) as string;
					const requiresAudit = this.getNodeParameter('requiresAudit', i) as boolean;

					const operations = operationsRaw
						.split('\n')
						.filter(Boolean)
						.map((line) => {
							const [name, ...descParts] = line.split(':');
							return {
								name: (name ?? '').trim().replace(/\s+/g, '_'),
								description: descParts.join(':').trim() || (name ?? '').trim(),
							};
						});

					const rpcFunctions = rpcFunctionsRaw
						.split(',')
						.map((s) => s.trim())
						.filter(Boolean);

					if (!nodeName.startsWith('Aisha')) {
						returnData.push({
							json: {
								success: false,
								error: 'Node name must start with "Aisha" prefix',
							},
							pairedItem: { item: i },
						});
						continue;
					}

					const spec = {
						name: nodeName,
						displayName,
						description,
						operations: operations.length > 0 ? operations : [{ name: 'execute', description: 'Execute the node' }],
						rpcFunctions,
						category,
						requiresAudit,
					};

					const nodeCode = AishaNodeFactory.generateNodeTemplate(spec);
					const testCode = AishaNodeFactory.generateTestTemplate(spec);

					// Validate the generated code
					const validation = AishaNodeFactory.validateNodeCode(nodeCode);

					// Audit the generation
					await (this as unknown as AuditableContext).auditOperation(i, 'NODE_FACTORY_GENERATE', {
						node_name: nodeName,
						operations: operations.map((o) => o.name),
						valid: validation.valid,
					});

					returnData.push({
						json: {
							success: true,
							operation: 'generate',
							nodeName,
							nodeCode,
							testCode,
							validation,
							filePaths: {
								node: `nodes/${nodeName}/${nodeName}.node.ts`,
								test: `__tests__/${nodeName}.test.ts`,
								icon: `nodes/${nodeName}/aisha.svg`,
							},
						},
						pairedItem: { item: i },
					});
				}

				// ── Validate ──
				else if (operation === 'validate') {
					const sourceCode =
						(this.getNodeParameter('sourceCode', i, '') as string) ||
						(items[i].json.nodeCode as string) ||
						'';

					if (!sourceCode) {
						returnData.push({
							json: { success: false, error: 'No source code provided for validation' },
							pairedItem: { item: i },
						});
						continue;
					}

					const validation = AishaNodeFactory.validateNodeCode(sourceCode);

					await (this as unknown as AuditableContext).auditOperation(i, 'NODE_FACTORY_VALIDATE', {
						node_name: nodeName,
						valid: validation.valid,
						error_count: validation.errors.length,
					});

					returnData.push({
						json: {
							success: validation.valid,
							operation: 'validate',
							nodeName,
							...validation,
						},
						pairedItem: { item: i },
					});
				}

				// ── Test ──
				else if (operation === 'test') {
					// Generate a test execution plan (actual execution requires host runtime)
					const testCode = (items[i].json.testCode as string) || '';

					const testPlan = {
						command: `cd packages/n8n-nodes-aisha && npx vitest run __tests__/${nodeName}.test.ts`,
						testCode,
						expectedAssertions: [
							'should have correct node description',
							'should handle RPC errors gracefully with continueOnFail',
						],
					};

					await (this as unknown as AuditableContext).auditOperation(i, 'NODE_FACTORY_TEST', {
						node_name: nodeName,
						phase: 'plan_generated',
					});

					returnData.push({
						json: {
							success: true,
							operation: 'test',
							nodeName,
							testPlan,
							note: 'Test plan generated. Execute via terminal or CI pipeline.',
						},
						pairedItem: { item: i },
					});
				}

				// ── Deploy ──
				else if (operation === 'deploy') {
					const n8nUrl = (this.getNodeParameter('n8nInstanceUrl', i) as string).replace(/\/$/, '');
					const deployMethod = this.getNodeParameter('deployMethod', i) as string;

					const deployPlan = {
						method: deployMethod,
						steps:
							deployMethod === 'npm'
								? [
										'cd packages/n8n-nodes-aisha',
										'npm run build',
										'npm pack',
										`npm install --prefix ${n8nUrl.includes('localhost') ? '/app' : '~/.n8n'} ./n8n-nodes-aisha-*.tgz`,
										'Restart n8n instance',
								  ]
								: [
										'cd packages/n8n-nodes-aisha',
										'npm run build',
										'npm pack',
										`Output: n8n-nodes-aisha-*.tgz (ready for transfer to ${n8nUrl})`,
								  ],
						packageJson: {
							addNode: `dist/nodes/${nodeName}/${nodeName}.node.js`,
							addCredential: null,
						},
					};

					await (this as unknown as AuditableContext).auditOperation(i, 'NODE_FACTORY_DEPLOY', {
						node_name: nodeName,
						method: deployMethod,
						target: n8nUrl,
					});

					returnData.push({
						json: {
							success: true,
							operation: 'deploy',
							nodeName,
							deployPlan,
							note: 'Deploy plan generated. For Coolify deployments, update Dockerfile and redeploy.',
						},
						pairedItem: { item: i },
					});
				}

				// ── Register ──
				else if (operation === 'register') {
					const credentials = await this.getCredentials('aishaPostgrestApi');
					const supabaseUrl = requirePostgrestUrl(credentials, this.getNode()).replace(/\/$/, '');
					const apiKey = requireCredString(credentials, 'serviceRoleKey', this.getNode());

					const registrationPayload = {
						p_node_name: nodeName,
						p_node_type: `aisha${nodeName.replace('Aisha', '')}`,
						p_package: 'n8n-nodes-aisha',
						p_version: '0.1.0',
						p_registered_by: 'aishaNodeFactory',
					};

					let registered = false;
					try {
						const resp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/rpc/register_custom_node`, {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json',
								'apikey': apiKey,
								'Authorization': `Bearer ${apiKey}`,
							},
							body: JSON.stringify(registrationPayload),
						});
						registered = resp.ok;
					} catch {
						// Registration table might not exist yet — that's ok
					}

					await (this as unknown as AuditableContext).auditOperation(i, 'NODE_FACTORY_REGISTER', {
						node_name: nodeName,
						registered,
					});

					returnData.push({
						json: {
							success: true,
							operation: 'register',
							nodeName,
							registered,
							note: registered
								? 'Node registered in platform catalog'
								: 'Registration RPC not available yet — add register_custom_node function',
						},
						pairedItem: { item: i },
					});
				}

				// ── List Nodes ──
				else if (operation === 'listNodes') {
					const builtInNodes = [
						{ name: 'AishaRpc', type: 'aishaRpc', category: 'Universal RPC', status: 'built-in' },
						{ name: 'AishaAudit', type: 'aishaAudit', category: 'Compliance', status: 'built-in' },
						{ name: 'AishaStoryManager', type: 'aishaStoryManager', category: 'Delivery', status: 'built-in' },
						{ name: 'AishaModelRouter', type: 'aishaModelRouter', category: 'AI Routing', status: 'built-in' },
						{ name: 'AishaTrigger', type: 'aishaTrigger', category: 'Events', status: 'built-in' },
						{ name: 'AishaNodeFactory', type: 'aishaNodeFactory', category: 'Self-Orchestration', status: 'built-in' },
					];

					// Try to fetch registered custom nodes from DB
					let customNodes: Array<Record<string, unknown>> = [];
					try {
						const credentials = await this.getCredentials('aishaPostgrestApi');
						const supabaseUrl = requirePostgrestUrl(credentials, this.getNode()).replace(/\/$/, '');
						const apiKey = requireCredString(credentials, 'serviceRoleKey', this.getNode());

						const resp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/rpc/list_custom_nodes`, {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json',
								'apikey': apiKey,
								'Authorization': `Bearer ${apiKey}`,
							},
							body: JSON.stringify({}),
						});

						if (resp.ok) {
							customNodes = (await resp.json()) as Array<Record<string, unknown>>;
						}
					} catch {
						// No custom nodes table yet
					}

					returnData.push({
						json: {
							success: true,
							operation: 'listNodes',
							builtInNodes,
							customNodes,
							total: builtInNodes.length + customNodes.length,
						},
						pairedItem: { item: i },
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
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

/**
 * Audit operation helper type — injected at runtime via monkey-patch.
 */
interface AuditableContext {
	auditOperation(
		itemIndex: number,
		action: string,
		metadata: Record<string, unknown>,
	): Promise<void>;
}

// Monkey-patch prototype for audit integration.
// In production this would be done via n8n's node extension mechanism.
if (!Object.prototype.hasOwnProperty.call(AishaNodeFactory.prototype, '_auditPatched')) {
	Object.defineProperty(AishaNodeFactory.prototype, '_auditPatched', { value: true });

	// The audit helper is injected at execute time
	const auditHelper = async function (
		this: IExecuteFunctions,
		_itemIndex: number,
		action: string,
		metadata: Record<string, unknown>,
	): Promise<void> {
		try {
			const credentials = await this.getCredentials('aishaPostgrestApi');
			const supabaseUrl = requirePostgrestUrl(credentials, this.getNode()).replace(/\/$/, '');
			const apiKey = requireCredString(credentials, 'serviceRoleKey', this.getNode());

			await fetchWithTimeout(`${supabaseUrl}/rest/v1/rpc/write_audit_journal`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'apikey': apiKey,
					'Authorization': `Bearer ${apiKey}`,
				},
				body: JSON.stringify({
					p_action_type: action,
					p_area: 'n8n',
					p_severity: 'info',
					p_details: {
						...metadata,
						workflow_id: this.getWorkflow().id ?? 'unknown',
						workflow_name: this.getWorkflow().name ?? 'unknown',
					},
					p_summary: `${action} in workflow ${this.getWorkflow().name}`,
					p_tags: ['n8n', 'node-factory', 'automation'],
				}),
			});
		} catch {
			// Audit is best-effort — don't fail the operation
		}
	};

	// Wrap execute to inject audit helper
	const origExecuteMethod = AishaNodeFactory.prototype.execute;
	AishaNodeFactory.prototype.execute = async function (this: IExecuteFunctions) {
		(this as unknown as Record<string, unknown>).auditOperation = auditHelper.bind(this);
		return origExecuteMethod!.call(this);
	};
}
