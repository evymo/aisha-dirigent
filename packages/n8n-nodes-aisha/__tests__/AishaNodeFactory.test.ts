import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AishaNodeFactory } from '../nodes/AishaNodeFactory/AishaNodeFactory.node';
import { createMockExecuteFunctions, setupFetchMock, mockFetchResponse } from './helpers/mockFactory';

describe('AishaNodeFactory', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.restoreAllMocks();
		fetchMock = setupFetchMock({ success: true });
	});

	it('should have correct node description', () => {
		const node = new AishaNodeFactory();
		expect(node.description.name).toBe('aishaNodeFactory');
		expect(node.description.version).toBe(1);
	});

	it('should have all 6 operations', () => {
		const node = new AishaNodeFactory();
		const opProp = node.description.properties.find((p) => p.name === 'operation');
		const options = (opProp as { options?: Array<{ value: string }> })?.options ?? [];
		const values = options.map((o) => o.value);
		expect(values).toEqual(['generate', 'validate', 'test', 'deploy', 'register', 'listNodes']);
	});

	// ── Generate ──
	describe('generate operation', () => {
		it('should generate valid node TypeScript code', async () => {
			const ctx = createMockExecuteFunctions({
				operation: 'generate',
				nodeName: 'AishaHealthCheck',
				nodeDisplayName: 'AISHA Health Check',
				nodeDescription: 'Manages health check-in records for the platform',
				nodeOperations: 'getAll: Retrieve all health check-ins\ncreate: Create a new check-in\nanalyze: Run trend analysis',
				nodeRpcFunctions: 'get_health_check_ins_audited, insert_health_check_in, analyze_health_trends',
				nodeCategory: 'action',
				requiresAudit: true,
			});

			const node = new AishaNodeFactory();
			const result = await node.execute.call(ctx);

			const output = result[0][0].json;
			expect(output.success).toBe(true);
			expect(output.operation).toBe('generate');
			expect(output.nodeName).toBe('AishaHealthCheck');

			const code = output.nodeCode as string;
			expect(code).toContain('class AishaHealthCheck implements INodeType');
			expect(code).toContain("displayName: 'AISHA Health Check'");
			expect(code).toContain("name: 'aishaHealthCheck'");
			expect(code).toContain("value: 'getAll'");
			expect(code).toContain("value: 'create'");
			expect(code).toContain("value: 'analyze'");
			expect(code).toContain('get_health_check_ins_audited');
			expect(code).toContain('insert_health_check_in');
			expect(code).toContain('write_audit_journal'); // audit trail

			const testCode = output.testCode as string;
			expect(testCode).toContain("describe('AishaHealthCheck'");
			expect(testCode).toContain('getAll operation');
			expect(testCode).toContain('create operation');
			expect(testCode).toContain('analyze operation');

			expect(output.validation).toBeDefined();
			const validation = output.validation as { valid: boolean };
			expect(validation.valid).toBe(true);
		});

		it('should reject node names without Aisha prefix', async () => {
			const ctx = createMockExecuteFunctions({
				operation: 'generate',
				nodeName: 'BadNodeName',
				nodeDisplayName: 'Bad',
				nodeDescription: 'Test',
				nodeOperations: 'test: Test operation',
				nodeRpcFunctions: '',
				nodeCategory: 'action',
				requiresAudit: false,
			});

			const node = new AishaNodeFactory();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(false);
			expect(result[0][0].json.error).toContain('Aisha');
		});

		it('should provide default operation if none specified', async () => {
			const ctx = createMockExecuteFunctions({
				operation: 'generate',
				nodeName: 'AishaSimple',
				nodeDisplayName: '',
				nodeDescription: 'Simple test node',
				nodeOperations: '', // empty
				nodeRpcFunctions: '',
				nodeCategory: 'action',
				requiresAudit: false,
			});

			const node = new AishaNodeFactory();
			const result = await node.execute.call(ctx);

			const code = result[0][0].json.nodeCode as string;
			expect(code).toContain("value: 'execute'");
		});
	});

	// ── Validate ──
	describe('validate operation', () => {
		it('should validate correct node code', async () => {
			const validCode = `
import type { IExecuteFunctions, INodeType, INodeTypeDescription } from 'n8n-workflow';
export class AishaTest implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Test',
		name: 'aishaTest',
		version: 1,
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'aishaPostgrestApi' }],
		properties: [],
	};
	async execute(this: IExecuteFunctions) {
		if (this.continueOnFail()) {}
		return [[]];
	}
}`;

			const ctx = createMockExecuteFunctions({
				operation: 'validate',
				nodeName: 'AishaTest',
				sourceCode: validCode,
			});

			const node = new AishaNodeFactory();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(result[0][0].json.valid).toBe(true);
			expect(result[0][0].json.errors).toHaveLength(0);
		});

		it('should detect missing INodeType', async () => {
			const badCode = `export class Foo { async execute() {} }`;

			const ctx = createMockExecuteFunctions({
				operation: 'validate',
				nodeName: 'AishaFoo',
				sourceCode: badCode,
			});

			const node = new AishaNodeFactory();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(false);
			expect(result[0][0].json.errors).toEqual(
				expect.arrayContaining([expect.stringContaining('INodeType')]),
			);
		});

		it('should detect security issues (eval)', async () => {
			const unsafeCode = `
export class AishaUnsafe implements INodeType {
	description: INodeTypeDescription = { displayName: 'x', name: 'y', version: 1, inputs: [], outputs: [] };
	async execute() { eval("danger"); return [[]]; }
}`;

			const ctx = createMockExecuteFunctions({
				operation: 'validate',
				nodeName: 'AishaUnsafe',
				sourceCode: unsafeCode,
			});

			const node = new AishaNodeFactory();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.valid).toBe(false);
			const errors = result[0][0].json.errors as string[];
			expect(errors.some((e) => e.includes('eval'))).toBe(true);
		});

		it('should detect .select("*") violation', async () => {
			const badCode = `
export class AishaStar implements INodeType {
	description: INodeTypeDescription = { displayName: 'x', name: 'y', version: 1, inputs: [], outputs: [] };
	async execute() { supabase.from("t").select("*"); return [[]]; }
}`;

			const ctx = createMockExecuteFunctions({
				operation: 'validate',
				nodeName: 'AishaStar',
				sourceCode: badCode,
			});

			const node = new AishaNodeFactory();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.valid).toBe(false);
			const errors = result[0][0].json.errors as string[];
			expect(errors.some((e) => e.includes('select("*")'))).toBe(true);
		});
	});

	// ── Test ──
	describe('test operation', () => {
		it('should generate test execution plan', async () => {
			const ctx = createMockExecuteFunctions({
				operation: 'test',
				nodeName: 'AishaHealthCheck',
				inputData: [
					{
						json: {
							testCode: 'import { describe } from "vitest"; describe("AishaHealthCheck", () => {});',
						},
					},
				],
			});

			const node = new AishaNodeFactory();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(result[0][0].json.operation).toBe('test');
			const testPlan = result[0][0].json.testPlan as { command: string };
			expect(testPlan.command).toContain('vitest run');
			expect(testPlan.command).toContain('AishaHealthCheck.test.ts');
		});
	});

	// ── Deploy ──
	describe('deploy operation', () => {
		it('should generate npm deploy plan', async () => {
			const ctx = createMockExecuteFunctions({
				operation: 'deploy',
				nodeName: 'AishaHealthCheck',
				n8nInstanceUrl: 'http://localhost:5678',
				deployMethod: 'npm',
			});

			const node = new AishaNodeFactory();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			const plan = result[0][0].json.deployPlan as { method: string; steps: string[] };
			expect(plan.method).toBe('npm');
			expect(plan.steps).toContain('npm run build');
			expect(plan.steps).toContain('npm pack');
		});

		it('should generate package-only plan', async () => {
			const ctx = createMockExecuteFunctions({
				operation: 'deploy',
				nodeName: 'AishaHealthCheck',
				n8nInstanceUrl: 'http://localhost:5678',
				deployMethod: 'package',
			});

			const node = new AishaNodeFactory();
			const result = await node.execute.call(ctx);

			const plan = result[0][0].json.deployPlan as { steps: string[] };
			expect(plan.steps).toContain('npm pack');
			expect(plan.steps.some((s: string) => s.includes('tgz'))).toBe(true);
		});
	});

	// ── Register ──
	describe('register operation', () => {
		it('should attempt RPC registration', async () => {
			const ctx = createMockExecuteFunctions({
				operation: 'register',
				nodeName: 'AishaHealthCheck',
			});

			const node = new AishaNodeFactory();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(result[0][0].json.registered).toBe(true);
		});

		it('should handle missing registration RPC gracefully', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse({ message: 'Function not found' }, false));

			const ctx = createMockExecuteFunctions({
				operation: 'register',
				nodeName: 'AishaHealthCheck',
			});

			const node = new AishaNodeFactory();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(result[0][0].json.registered).toBe(false);
			expect(result[0][0].json.note).toContain('not available');
		});
	});

	// ── List Nodes ──
	describe('listNodes operation', () => {
		it('should list all built-in nodes', async () => {
			const ctx = createMockExecuteFunctions({
				operation: 'listNodes',
			});

			const node = new AishaNodeFactory();
			const result = await node.execute.call(ctx);

			const output = result[0][0].json;
			expect(output.success).toBe(true);
			const builtIn = output.builtInNodes as Array<{ name: string }>;
			expect(builtIn).toHaveLength(6);
			const names = builtIn.map((n) => n.name);
			expect(names).toContain('AishaRpc');
			expect(names).toContain('AishaAudit');
			expect(names).toContain('AishaStoryManager');
			expect(names).toContain('AishaModelRouter');
			expect(names).toContain('AishaTrigger');
			expect(names).toContain('AishaNodeFactory');
		});
	});
});
