import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AishaModelRouter } from '../nodes/AishaModelRouter/AishaModelRouter.node';
import { createMockExecuteFunctions, setupFetchMock } from './helpers/mockFactory';

const ROUTE_MODELS = (
	AishaModelRouter as unknown as {
		ROUTE_MODELS?: Record<string, string>;
	}
).ROUTE_MODELS ?? {};

describe('AishaModelRouter', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.restoreAllMocks();
		fetchMock = setupFetchMock({});
	});

	it('should have correct node description', () => {
		const node = new AishaModelRouter();
		expect(node.description.name).toBe('aishaModelRouter');
		expect(node.description.version).toBe(1);
		// 5 outputs: OpenAI, Google, Anthropic, xAI, Fallback
		expect(node.description.outputs).toHaveLength(5);
		expect(node.description.outputNames).toEqual(['OpenAI', 'Google', 'Anthropic', 'xAI', 'Fallback']);
	});

	it('should route low-risk classification to Google', async () => {
		const ctx = createMockExecuteFunctions({
			routingStrategy: 'auto',
			task: 'Classify this ticket',
			riskLevel: 'low',
			taskType: 'classification',
		});

		const node = new AishaModelRouter();
		const result = await node.execute.call(ctx);

		// Output index 1 = Google
		expect(result[1]).toHaveLength(1);
		expect(result[0]).toHaveLength(0); // Not OpenAI
		expect(result[1][0].json._routing).toEqual(
			expect.objectContaining({
				provider: 'google',
				model: 'gemini-2.5-flash',
			}),
		);
	});

	it('should route high-risk tasks to OpenAI', async () => {
		const ctx = createMockExecuteFunctions({
			routingStrategy: 'auto',
			task: 'Review this compliance report',
			riskLevel: 'high',
			taskType: 'compliance',
		});

		const node = new AishaModelRouter();
		const result = await node.execute.call(ctx);

		// Output index 0 = OpenAI
		expect(result[0]).toHaveLength(1);
		expect(result[0][0].json._routing).toEqual(
			expect.objectContaining({
				provider: 'openai',
				model: 'gpt-4o',
			}),
		);
	});

	it('should route medium-risk code review to OpenAI', async () => {
		const ctx = createMockExecuteFunctions({
			routingStrategy: 'auto',
			task: 'Review this PR',
			riskLevel: 'medium',
			taskType: 'code_review',
		});

		const node = new AishaModelRouter();
		const result = await node.execute.call(ctx);

		expect(result[0]).toHaveLength(1);
		expect(result[0][0].json._routing).toEqual(
			expect.objectContaining({
				provider: 'openai',
				model: 'gpt-4o',
			}),
		);
	});

	it('should route explicit provider correctly', async () => {
		const ctx = createMockExecuteFunctions({
			routingStrategy: 'explicit',
			task: 'Anything',
			explicitProvider: 'anthropic',
		});

		const node = new AishaModelRouter();
		const result = await node.execute.call(ctx);

		// Output index 2 = Anthropic
		expect(result[2]).toHaveLength(1);
		expect(result[2][0].json._routing).toEqual(
			expect.objectContaining({
				provider: 'anthropic',
				model: ROUTE_MODELS.anthropic,
			}),
		);
	});

	it('should route costOptimized to Google by default', async () => {
		const ctx = createMockExecuteFunctions({
			routingStrategy: 'costOptimized',
			task: 'Summarize text',
		});

		const node = new AishaModelRouter();
		const result = await node.execute.call(ctx);

		expect(result[1]).toHaveLength(1);
		expect(result[1][0].json._routing?.provider).toBe('google');
	});

	it('should route qualityFirst always to OpenAI', async () => {
		const ctx = createMockExecuteFunctions({
			routingStrategy: 'qualityFirst',
			task: 'Complex analysis',
		});

		const node = new AishaModelRouter();
		const result = await node.execute.call(ctx);

		expect(result[0]).toHaveLength(1);
		expect(result[0][0].json._routing?.provider).toBe('openai');
	});

	it('should use DB overrides for fromDb strategy', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({
				model_overrides: {
					general: { provider: 'anthropic', model: 'claude-3-5-sonnet' },
				},
			}),
			text: async () => '',
		});

		const ctx = createMockExecuteFunctions({
			routingStrategy: 'fromDb',
			task: 'Test',
			agentSlug: 'dirigent-agent',
			taskType: 'general',
		});

		const node = new AishaModelRouter();
		const result = await node.execute.call(ctx);

		// Should be routed to Anthropic from DB
		expect(result[2]).toHaveLength(1);
		expect(result[2][0].json._routing?.provider).toBe('anthropic');
	});

	it('should fallback to auto when DB lookup fails', async () => {
		fetchMock.mockRejectedValue(new Error('Network error'));

		const ctx = createMockExecuteFunctions({
			routingStrategy: 'fromDb',
			task: 'Test',
			agentSlug: 'missing-agent',
			taskType: 'general',
			riskLevel: 'medium',
		});

		const node = new AishaModelRouter();
		const result = await node.execute.call(ctx);

		// Should fallback to auto routing
		const allOutputs = result.flatMap((arr) => arr);
		expect(allOutputs).toHaveLength(1);
		const routing = allOutputs[0].json._routing as Record<string, unknown>;
		expect(routing.reasoning).toContain('DB fallback');
	});

	it('should handle errors with continueOnFail', async () => {
		// Make getNodeParameter throw
		const ctx = createMockExecuteFunctions({
			routingStrategy: 'auto',
			task: 'Test',
			riskLevel: 'low',
			taskType: 'general',
			continueOnFail: true,
		});

		// Override to throw on second item
		vi.mocked(ctx.getInputData).mockReturnValue([{ json: {} }, { json: {} }]);
		const origGetParam = ctx.getNodeParameter as ReturnType<typeof vi.fn>;
		origGetParam.mockImplementation((name: string, index: number) => {
			if (index === 1) throw new Error('Item 1 error');
			const vals: Record<string, string> = {
				routingStrategy: 'auto',
				task: 'Test',
				riskLevel: 'low',
				taskType: 'general',
			};
			return vals[name] ?? '';
		});

		const node = new AishaModelRouter();
		const result = await node.execute.call(ctx);

		// First item normal, second in fallback
		const allOutputs = result.flatMap((arr) => arr);
		expect(allOutputs).toHaveLength(2);
		const fallbackItem = result[4].find((item) => item.json.error);
		expect(fallbackItem).toBeDefined();
	});

	it('should preserve original json in routed items', async () => {
		const ctx = createMockExecuteFunctions({
			routingStrategy: 'auto',
			task: 'Classify',
			riskLevel: 'low',
			taskType: 'classification',
			inputData: [{ json: { original: 'data', count: 42 } }],
		});

		const node = new AishaModelRouter();
		const result = await node.execute.call(ctx);

		const routed = result[1][0];
		expect(routed.json.original).toBe('data');
		expect(routed.json.count).toBe(42);
		expect(routed.json._routing).toBeDefined();
	});

	// ── xAI routing ──

	it('should route explicit xAI to output index 3', async () => {
		const ctx = createMockExecuteFunctions({
			routingStrategy: 'explicit',
			task: 'Test xAI',
			explicitProvider: 'xai',
		});

		const node = new AishaModelRouter();
		const result = await node.execute.call(ctx);

		// Output index 3 = xAI
		expect(result[3]).toHaveLength(1);
		expect(result[3][0].json._routing).toEqual(
			expect.objectContaining({
				provider: 'xai',
				model: 'grok-3-mini',
			}),
		);
	});

	// ── New task types ──

	it('should route medium-risk coding to OpenAI', async () => {
		const ctx = createMockExecuteFunctions({
			routingStrategy: 'auto',
			task: 'Implement feature',
			riskLevel: 'medium',
			taskType: 'coding',
		});

		const node = new AishaModelRouter();
		const result = await node.execute.call(ctx);

		expect(result[0]).toHaveLength(1);
		expect(result[0][0].json._routing).toEqual(
			expect.objectContaining({ provider: 'openai' }),
		);
	});

	it('should route medium-risk reasoning to OpenAI', async () => {
		const ctx = createMockExecuteFunctions({
			routingStrategy: 'auto',
			task: 'Deep analysis',
			riskLevel: 'medium',
			taskType: 'reasoning',
		});

		const node = new AishaModelRouter();
		const result = await node.execute.call(ctx);

		expect(result[0]).toHaveLength(1);
		expect(result[0][0].json._routing).toEqual(
			expect.objectContaining({ provider: 'openai' }),
		);
	});

	it('should route low-risk chat to Google', async () => {
		const ctx = createMockExecuteFunctions({
			routingStrategy: 'auto',
			task: 'Answer question',
			riskLevel: 'low',
			taskType: 'chat',
		});

		const node = new AishaModelRouter();
		const result = await node.execute.call(ctx);

		expect(result[1]).toHaveLength(1);
		expect(result[1][0].json._routing).toEqual(
			expect.objectContaining({ provider: 'google' }),
		);
	});

	it('should route high-risk reasoning to Anthropic', async () => {
		const ctx = createMockExecuteFunctions({
			routingStrategy: 'auto',
			task: 'Complex reasoning',
			riskLevel: 'high',
			taskType: 'reasoning',
		});

		const node = new AishaModelRouter();
		const result = await node.execute.call(ctx);

		expect(result[2]).toHaveLength(1);
		expect(result[2][0].json._routing).toEqual(
			expect.objectContaining({
				provider: 'anthropic',
				model: 'claude-sonnet-4-20250514',
			}),
		);
	});

	it('should route high-risk coding to Anthropic', async () => {
		const ctx = createMockExecuteFunctions({
			routingStrategy: 'auto',
			task: 'Critical code generation',
			riskLevel: 'high',
			taskType: 'coding',
		});

		const node = new AishaModelRouter();
		const result = await node.execute.call(ctx);

		expect(result[2]).toHaveLength(1);
		expect(result[2][0].json._routing).toEqual(
			expect.objectContaining({
				provider: 'anthropic',
				model: 'claude-sonnet-4-20250514',
			}),
		);
	});

	it('should route xAI via fromDb strategy', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({
				model_overrides: {
					general: { provider: 'xai', model: 'grok-3' },
				},
			}),
			text: async () => '',
		});

		const ctx = createMockExecuteFunctions({
			routingStrategy: 'fromDb',
			task: 'Test xAI from DB',
			agentSlug: 'test-agent',
			taskType: 'general',
		});

		const node = new AishaModelRouter();
		const result = await node.execute.call(ctx);

		// Output index 3 = xAI
		expect(result[3]).toHaveLength(1);
		expect(result[3][0].json._routing?.provider).toBe('xai');
		expect(result[3][0].json._routing?.model).toBe('grok-3');
	});
});
