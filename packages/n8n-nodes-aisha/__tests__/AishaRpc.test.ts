import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AishaRpc } from '../nodes/AishaRpc/AishaRpc.node';
import { createMockExecuteFunctions, setupFetchMock, mockFetchResponse } from './helpers/mockFactory';

describe('AishaRpc', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.restoreAllMocks();
		fetchMock = setupFetchMock([{ id: '1', name: 'test' }]);
	});

	it('should have correct node description', () => {
		const node = new AishaRpc();
		expect(node.description.name).toBe('aishaRpc');
		expect(node.description.version).toBe(1);
		expect(node.description.group).toContain('transform');
		expect(node.description.credentials).toBeDefined();
		expect(node.description.credentials?.[0]?.name).toBe('aishaPostgrestApi');
	});

	it('should have all RPC function options', () => {
		const node = new AishaRpc();
		// Implementation uses category + multiple functionName properties
		const categoryProp = node.description.properties.find((p) => p.name === 'category');
		expect(categoryProp).toBeDefined();
		expect(categoryProp?.type).toBe('options');
		// functionName appears multiple times (one per category)
		const funcProps = node.description.properties.filter((p) => p.name === 'functionName');
		expect(funcProps.length).toBeGreaterThan(0);
	});

	it('should execute a knowledge RPC call', async () => {
		const ctx = createMockExecuteFunctions({
			category: 'knowledge',
			functionName: 'mcp_get_knowledge_stats',
			rpcParams: '{}',
			authMode: 'service_role',
			options: {},
		});

		const node = new AishaRpc();
		const result = await node.execute.call(ctx);

		expect(result).toBeDefined();
		expect(result[0]).toHaveLength(1);
		expect(fetchMock).toHaveBeenCalled();

		const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toContain('/rest/v1/rpc/mcp_get_knowledge_stats');
	});

	it('should use anon key when authMode is anon', async () => {
		const ctx = createMockExecuteFunctions({
			category: 'knowledge',
			functionName: 'mcp_get_knowledge_stats',
			rpcParams: '{}',
			authMode: 'anon',
			options: {},
		});

		const node = new AishaRpc();
		const result = await node.execute.call(ctx);

		expect(result).toBeDefined();
		const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
		const headers = options.headers as Record<string, string>;
		expect(headers.Authorization).toContain('test-anon-key');
	});

	it('should handle custom RPC function', async () => {
		const ctx = createMockExecuteFunctions({
			category: 'custom',
			functionName: 'my_custom_function',
			rpcParams: '{"p_limit": 10}',
			authMode: 'service_role',
			options: {},
		});

		const node = new AishaRpc();
		await node.execute.call(ctx);

		const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toContain('/rest/v1/rpc/my_custom_function');
	});

	it('should handle RPC errors gracefully with continueOnFail', async () => {
		fetchMock.mockResolvedValue(
			mockFetchResponse({ message: 'Function not found', code: 'PGRST202' }, false),
		);

		const ctx = createMockExecuteFunctions({
			category: 'knowledge',
			functionName: 'mcp_get_knowledge_stats',
			rpcParams: '{}',
			authMode: 'service_role',
			options: {},
			continueOnFail: true,
		});

		const node = new AishaRpc();
		const result = await node.execute.call(ctx);

		expect(result[0][0].json).toHaveProperty('error');
	});

	it('should throw on RPC error when continueOnFail is false', async () => {
		fetchMock.mockResolvedValue(
			mockFetchResponse({ message: 'Permission denied' }, false),
		);

		const ctx = createMockExecuteFunctions({
			category: 'knowledge',
			functionName: 'mcp_get_knowledge_stats',
			rpcParams: '{}',
			authMode: 'service_role',
			options: {},
			continueOnFail: false,
		});

		const node = new AishaRpc();
		await expect(node.execute.call(ctx)).rejects.toThrow();
	});

	it('should include audit headers when auditTrail is true', async () => {
		const ctx = createMockExecuteFunctions({
			category: 'knowledge',
			functionName: 'mcp_get_knowledge_stats',
			rpcParams: '{}',
			authMode: 'service_role',
			options: { auditTrail: true, auditArea: 'n8n_automation' },
		});

		const node = new AishaRpc();
		await node.execute.call(ctx);

		const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
		const headers = options.headers as Record<string, string>;
		expect(headers['X-Aisha-Audit-Source']).toBe('n8n-nodes-aisha');
		expect(headers['X-Aisha-Node-Name']).toBe('Test Node');
	});
});
