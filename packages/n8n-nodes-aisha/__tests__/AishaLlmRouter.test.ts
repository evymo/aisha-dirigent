import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AishaLlmRouter } from '../nodes/AishaLlmRouter/AishaLlmRouter.node';
import { isProviderFatalError } from '../nodes/AishaLlmRouter/AishaLlmRouter.node';
import { createMockSupplyDataFunctions } from './helpers/mockFactory';

/**
 * AishaLlmRouter uses dynamic require() for @langchain/* modules.
 * We mock the private static createModel method to avoid needing
 * the actual langchain packages in the test environment.
 */
describe('AishaLlmRouter', () => {
	const savedEnv = { ...process.env };
	let createModelSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		// Clear all LLM env vars
		delete process.env.GOOGLE_AI_API_KEY;
		delete process.env.OPENAI_API_KEY;
		delete process.env.ANTHROPIC_API_KEY;
		delete process.env.XAI_API_KEY;

		// Mock the private static createModel to avoid require('@langchain/*')
		createModelSpy = vi.fn().mockImplementation(
			(_ctx: unknown, provider: string, _apiKey: string, modelName: string) => ({
				_mockModel: true,
				provider,
				model: modelName,
			}),
		);
		// @ts-expect-error — accessing private static for testing
		AishaLlmRouter.createModel = createModelSpy;
	});

	afterEach(() => {
		process.env = { ...savedEnv };
	});

	it('should have correct node description', () => {
		const node = new AishaLlmRouter();
		expect(node.description.name).toBe('aishaLlmRouter');
		expect(node.description.version).toBe(1);
		expect(node.description.outputs).toEqual(['ai_languageModel']);
	});

	it('should list all 4 providers in explicit dropdown', () => {
		const node = new AishaLlmRouter();
		const providerProp = node.description.properties.find((p) => p.name === 'explicitProvider');
		expect(providerProp).toBeDefined();
		const values = (providerProp!.options as Array<{ value: string }>).map((o) => o.value);
		expect(values).toEqual(['google', 'openai', 'anthropic', 'xai']);
	});

	// ── Auto-detection ──

	it('should auto-detect Google when only GOOGLE_AI_API_KEY set', async () => {
		process.env.GOOGLE_AI_API_KEY = 'test-google-key';

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		expect(result.response).toBeDefined();
		expect(result.metadata).toEqual(
			expect.objectContaining({
				provider: 'google',
				model: 'gemini-2.5-flash',
				source: 'env',
				strategy: 'auto',
			}),
		);
		expect(createModelSpy).toHaveBeenCalledWith(
			expect.anything(),
			'google',
			'test-google-key',
			'gemini-2.5-flash',
			expect.any(Object),
		);
	});

	it('should auto-detect OpenAI when only OPENAI_API_KEY set', async () => {
		process.env.OPENAI_API_KEY = 'test-openai-key';

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		expect(result.metadata).toEqual(
			expect.objectContaining({ provider: 'openai', model: 'gpt-4o-mini', source: 'env' }),
		);
		expect(createModelSpy).toHaveBeenCalledWith(
			expect.anything(),
			'openai',
			'test-openai-key',
			'gpt-4o-mini',
			expect.any(Object),
		);
	});

	it('should auto-detect Anthropic when only ANTHROPIC_API_KEY set', async () => {
		process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		expect(result.metadata).toEqual(
			expect.objectContaining({ provider: 'anthropic', source: 'env' }),
		);
		expect(createModelSpy).toHaveBeenCalledWith(
			expect.anything(),
			'anthropic',
			'test-anthropic-key',
			expect.any(String),
			expect.any(Object),
		);
	});

	it('should respect priority: Google > OpenAI > Anthropic', async () => {
		process.env.GOOGLE_AI_API_KEY = 'gk';
		process.env.OPENAI_API_KEY = 'ok';
		process.env.ANTHROPIC_API_KEY = 'ak';

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		expect(result.metadata).toEqual(expect.objectContaining({ provider: 'google' }));
	});

	it('should skip Google when its key is empty, pick OpenAI', async () => {
		process.env.GOOGLE_AI_API_KEY = '  '; // whitespace-only
		process.env.OPENAI_API_KEY = 'ok';

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		expect(result.metadata).toEqual(expect.objectContaining({ provider: 'openai' }));
	});

	it('should NOT auto-detect xAI (not in PROVIDER_PRIORITY)', async () => {
		// Only XAI key set — should fail because xAI is not in auto-detection
		process.env.XAI_API_KEY = 'xai-test-key';

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		await expect(node.supplyData.call(ctx, 0)).rejects.toThrow('No LLM provider available');
	});

	// ── Explicit provider ──

	it('should use explicit Google', async () => {
		process.env.GOOGLE_AI_API_KEY = 'gk';

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'explicit',
			explicitProvider: 'google',
			modelOverride: '',
			options: { temperature: 0.7 },
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		expect(result.metadata).toEqual(
			expect.objectContaining({ provider: 'google', strategy: 'explicit' }),
		);
		expect(createModelSpy).toHaveBeenCalledWith(
			expect.anything(),
			'google',
			'gk',
			'gemini-2.5-flash',
			expect.objectContaining({ temperature: 0.7 }),
		);
	});

	it('should use explicit xAI', async () => {
		process.env.XAI_API_KEY = 'xai-test-key';

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'explicit',
			explicitProvider: 'xai',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		expect(result.metadata).toEqual(
			expect.objectContaining({
				provider: 'xai',
				model: 'grok-3-mini',
				source: 'env',
				strategy: 'explicit',
			}),
		);
		expect(createModelSpy).toHaveBeenCalledWith(
			expect.anything(),
			'xai',
			'xai-test-key',
			'grok-3-mini',
			expect.any(Object),
		);
	});

	it('should throw when explicit provider has no key', async () => {
		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'explicit',
			explicitProvider: 'openai',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		await expect(node.supplyData.call(ctx, 0)).rejects.toThrow(
			"Provider 'openai' selected but no API key found",
		);
	});

	// ── Model override ──

	it('should use model override when provided', async () => {
		process.env.OPENAI_API_KEY = 'ok';

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'explicit',
			explicitProvider: 'openai',
			modelOverride: 'gpt-4o-mini',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		expect(result.metadata?.model).toBe('gpt-4o-mini');
		expect(createModelSpy).toHaveBeenCalledWith(
			expect.anything(),
			'openai',
			'ok',
			'gpt-4o-mini',
			expect.any(Object),
		);
	});

	it('should use xAI model override', async () => {
		process.env.XAI_API_KEY = 'xk';

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'explicit',
			explicitProvider: 'xai',
			modelOverride: 'grok-3',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		expect(result.metadata?.model).toBe('grok-3');
	});

	// ── Options ──

	it('should pass options to createModel', async () => {
		process.env.OPENAI_API_KEY = 'ok';

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: { temperature: 0.9, maxOutputTokens: 8192, topP: 0.8, maxRetries: 5 },
		});

		const node = new AishaLlmRouter();
		await node.supplyData.call(ctx, 0);

		expect(createModelSpy).toHaveBeenCalledWith(
			expect.anything(),
			'openai',
			'ok',
			'gpt-4o-mini',
			expect.objectContaining({
				temperature: 0.9,
				maxOutputTokens: 8192,
				topP: 0.8,
				maxRetries: 5,
			}),
		);
	});

	// ── Credentials ──

	it('should prefer n8n credential over env var', async () => {
		process.env.OPENAI_API_KEY = 'env-key';

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'explicit',
			explicitProvider: 'openai',
			modelOverride: '',
			options: {},
			credentials: {
				openAiApi: { apiKey: 'credential-key' },
			},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		expect(result.metadata?.source).toBe('credential');
		expect(createModelSpy).toHaveBeenCalledWith(
			expect.anything(),
			'openai',
			'credential-key',
			expect.any(String),
			expect.any(Object),
		);
	});

	// ── No provider ──

	it('should throw descriptive error when no provider available', async () => {
		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		await expect(node.supplyData.call(ctx, 0)).rejects.toThrow('No LLM provider available');
	});

	// ── UI message ──

	it('should send routing decision to UI', async () => {
		process.env.GOOGLE_AI_API_KEY = 'gk';

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		await node.supplyData.call(ctx, 0);

		expect(ctx.sendMessageToUI).toHaveBeenCalledWith(
			expect.stringContaining('LLM Router → google/gemini-2.5-flash (env)'),
		);
	});

	// ── Fallback chain ──

	it('should include fallback providers in metadata when multiple keys available', async () => {
		process.env.GOOGLE_AI_API_KEY = 'gk';
		process.env.OPENAI_API_KEY = 'ok';
		process.env.ANTHROPIC_API_KEY = 'ak';

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		expect(result.metadata).toEqual(
			expect.objectContaining({
				provider: 'google',
				fallbackProviders: ['openai', 'anthropic'],
			}),
		);
	});

	it('should have empty fallback list when only one provider available', async () => {
		process.env.OPENAI_API_KEY = 'ok';

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		expect(result.metadata).toEqual(
			expect.objectContaining({
				provider: 'openai',
				fallbackProviders: [],
			}),
		);
	});

	it('should wrap model in proxy when fallbacks exist', async () => {
		process.env.GOOGLE_AI_API_KEY = 'gk';
		process.env.OPENAI_API_KEY = 'ok';

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		// Model should be a Proxy wrapping the mock — still has the mock's properties
		const model = result.response as Record<string, unknown>;
		expect(model._mockModel).toBe(true);
		expect(model.provider).toBe('google');
	});

	it('should show fallback info in UI message', async () => {
		process.env.GOOGLE_AI_API_KEY = 'gk';
		process.env.OPENAI_API_KEY = 'ok';

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		await node.supplyData.call(ctx, 0);

		expect(ctx.sendMessageToUI).toHaveBeenCalledWith(
			expect.stringContaining('[fallbacks: openai]'),
		);
	});

	it('should show [no fallbacks] when only one provider', async () => {
		process.env.ANTHROPIC_API_KEY = 'ak';

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		await node.supplyData.call(ctx, 0);

		expect(ctx.sendMessageToUI).toHaveBeenCalledWith(
			expect.stringContaining('[no fallbacks]'),
		);
	});

	// ── Fallback proxy behavior ──

	it('should switch to fallback on quota error', async () => {
		process.env.GOOGLE_AI_API_KEY = 'gk';
		process.env.OPENAI_API_KEY = 'ok';

		// Make createModel return models with invoke method
		let callCount = 0;
		createModelSpy.mockImplementation(
			(_ctx: unknown, provider: string, _apiKey: string, modelName: string) => ({
				_mockModel: true,
				provider,
				model: modelName,
				invoke: async () => {
					callCount++;
					if (provider === 'google') {
						throw new Error('You exceeded your current quota, please check your plan and billing details.');
					}
					return { content: `Response from ${provider}` };
				},
			}),
		);

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		const model = result.response as { invoke: (msg: string) => Promise<unknown> };
		const response = await model.invoke('Hello');

		expect(response).toEqual({ content: 'Response from openai' });
		// Google invoke (failed) + OpenAI invoke (succeeded)
		expect(callCount).toBe(2);
		// Should have notified UI about fallback
		expect(ctx.sendMessageToUI).toHaveBeenCalledWith(
			expect.stringContaining('LLM Fallback'),
		);
	});

	it('should chain through multiple fallbacks on successive failures', async () => {
		process.env.GOOGLE_AI_API_KEY = 'gk';
		process.env.OPENAI_API_KEY = 'ok';
		process.env.ANTHROPIC_API_KEY = 'ak';

		createModelSpy.mockImplementation(
			(_ctx: unknown, provider: string, _apiKey: string, modelName: string) => ({
				_mockModel: true,
				provider,
				model: modelName,
				invoke: async () => {
					if (provider === 'google') {
						throw new Error('429 Too Many Requests');
					}
					if (provider === 'openai') {
						throw new Error('insufficient_quota');
					}
					return { content: `Response from ${provider}` };
				},
			}),
		);

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		const model = result.response as { invoke: (msg: string) => Promise<unknown> };
		const response = await model.invoke('Hello');

		expect(response).toEqual({ content: 'Response from anthropic' });
	});

	it('should propagate error when all providers fail', async () => {
		process.env.GOOGLE_AI_API_KEY = 'gk';
		process.env.OPENAI_API_KEY = 'ok';

		createModelSpy.mockImplementation(
			(_ctx: unknown, provider: string, _apiKey: string, modelName: string) => ({
				_mockModel: true,
				provider,
				model: modelName,
				invoke: async () => {
					throw new Error(`${provider}: exceeded your current quota`);
				},
			}),
		);

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		const model = result.response as { invoke: (msg: string) => Promise<unknown> };
		await expect(model.invoke('Hello')).rejects.toThrow('exceeded your current quota');
	});

	it('should not fallback on non-provider errors', async () => {
		process.env.GOOGLE_AI_API_KEY = 'gk';
		process.env.OPENAI_API_KEY = 'ok';

		createModelSpy.mockImplementation(
			(_ctx: unknown, provider: string, _apiKey: string, modelName: string) => ({
				_mockModel: true,
				provider,
				model: modelName,
				invoke: async () => {
					if (provider === 'google') {
						throw new Error('Invalid prompt: content policy violation');
					}
					return { content: `Response from ${provider}` };
				},
			}),
		);

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		const model = result.response as { invoke: (msg: string) => Promise<unknown> };
		// Should NOT fallback — content policy errors are not provider-fatal
		await expect(model.invoke('Hello')).rejects.toThrow('content policy violation');
	});

	it('should handle provider down (503) with fallback', async () => {
		process.env.OPENAI_API_KEY = 'ok';
		process.env.ANTHROPIC_API_KEY = 'ak';

		createModelSpy.mockImplementation(
			(_ctx: unknown, provider: string, _apiKey: string, modelName: string) => ({
				_mockModel: true,
				provider,
				model: modelName,
				invoke: async () => {
					if (provider === 'openai') {
						throw new Error('503 Service Unavailable');
					}
					return { content: `Response from ${provider}` };
				},
			}),
		);

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		const model = result.response as { invoke: (msg: string) => Promise<unknown> };
		const response = await model.invoke('Hello');
		expect(response).toEqual({ content: 'Response from anthropic' });
	});

	it('should fallback on resource-not-found (404) errors', async () => {
		process.env.OPENAI_API_KEY = 'ok';
		process.env.ANTHROPIC_API_KEY = 'ak';

		createModelSpy.mockImplementation(
			(_ctx: unknown, provider: string, _apiKey: string, modelName: string) => ({
				_mockModel: true,
				provider,
				model: modelName,
				invoke: async () => {
					if (provider === 'openai') {
						throw new Error('The resource you are requesting could not be found');
					}
					return { content: `Response from ${provider}` };
				},
			}),
		);

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		const model = result.response as { invoke: (msg: string) => Promise<unknown> };
		const response = await model.invoke('Hello');
		expect(response).toEqual({ content: 'Response from anthropic' });
	});

	it('should preserve fallback behavior after bindTools', async () => {
		process.env.OPENAI_API_KEY = 'ok';
		process.env.ANTHROPIC_API_KEY = 'ak';

		createModelSpy.mockImplementation(
			(_ctx: unknown, provider: string, _apiKey: string, modelName: string) => ({
				_mockModel: true,
				provider,
				model: modelName,
				bindTools: (_tools: unknown[]) => ({
					provider,
					invoke: async () => {
						if (provider === 'openai') {
							throw new Error('insufficient_quota');
						}
						return { content: `Response from ${provider}` };
					},
				}),
			}),
		);

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		const model = result.response as {
			bindTools: (tools: unknown[]) => { invoke: (msg: string) => Promise<unknown> };
		};
		const boundModel = model.bindTools([]);
		const response = await boundModel.invoke('Hello');
		expect(response).toEqual({ content: 'Response from anthropic' });
	});

	it('should fallback on generate() method (without underscore)', async () => {
		process.env.GOOGLE_AI_API_KEY = 'gk';
		process.env.OPENAI_API_KEY = 'ok';

		createModelSpy.mockImplementation(
			(_ctx: unknown, provider: string, _apiKey: string, modelName: string) => ({
				_mockModel: true,
				provider,
				model: modelName,
				invoke: async () => ({ content: `Response from ${provider}` }),
				generate: async () => {
					if (provider === 'google') {
						throw new Error(
							'[GoogleGenerativeAI Error]: [404 Not Found] models/gemini-1.5-flash is not found',
						);
					}
					return { generations: [[{ text: `Response from ${provider}` }]] };
				},
			}),
		);

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		const model = result.response as {
			generate: (msgs: unknown[]) => Promise<unknown>;
		};
		const response = await model.generate([]);
		expect(response).toEqual({ generations: [[{ text: 'Response from openai' }]] });
	});

	it('should proxy _streamResponseChunks as async generator with fallback', async () => {
		process.env.GOOGLE_AI_API_KEY = 'gk';
		process.env.OPENAI_API_KEY = 'ok';

		createModelSpy.mockImplementation(
			(_ctx: unknown, provider: string, _apiKey: string, modelName: string) => ({
				_mockModel: true,
				provider,
				model: modelName,
				invoke: async () => ({ content: `Response from ${provider}` }),
				async *_streamResponseChunks() {
					if (provider === 'google') {
						throw new Error('You exceeded your current quota');
					}
					yield { content: 'chunk1' };
					yield { content: 'chunk2' };
				},
			}),
		);

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		const model = result.response as {
			_streamResponseChunks: (...args: unknown[]) => AsyncGenerator<unknown>;
		};
		const chunks: unknown[] = [];
		for await (const chunk of model._streamResponseChunks('msg', {})) {
			chunks.push(chunk);
		}
		expect(chunks).toEqual([{ content: 'chunk1' }, { content: 'chunk2' }]);
	});

	// ── isProviderFatalError unit tests ──

	describe('isProviderFatalError', () => {
		it.each([
			['exceeded your current quota', 'quota/billing'],
			['insufficient_quota', 'quota/billing'],
			['billing issue detected', 'quota/billing'],
			['rate_limit exceeded', 'quota/billing'],
			['rate limit reached', 'quota/billing'],
			['429 Too Many Requests', 'quota/billing'],
			['quota exhausted', 'quota/billing'],
			['RateLimitError', 'quota/billing'],
			['insufficient funds', 'quota/billing'],
			['payment required', 'quota/billing'],
			['402 Payment Required', 'quota/billing'],
			['too many requests', 'quota/billing'],
		])('should detect quota/billing error: "%s"', (errorMsg, expectedPrefix) => {
			const result = isProviderFatalError(new Error(errorMsg));
			expect(result).not.toBeNull();
			expect(result).toContain(expectedPrefix);
		});

		it.each([
			['503 Service Unavailable', 'provider down'],
			['502 Bad Gateway', 'provider down'],
			['service unavailable', 'provider down'],
			['overloaded with requests', 'provider down'],
			['server error occurred', 'provider down'],
			['500 Internal Server Error', 'provider down'],
			['ECONNREFUSED', 'provider down'],
			['ETIMEDOUT', 'provider down'],
			['network error', 'provider down'],
		])('should detect provider-down error: "%s"', (errorMsg, expectedPrefix) => {
			const result = isProviderFatalError(new Error(errorMsg));
			expect(result).not.toBeNull();
			expect(result).toContain(expectedPrefix);
		});

		it.each([
			['The resource you are requesting could not be found', 'provider config'],
			['model not found for API version v1beta', 'provider config'],
			['The model does not exist', 'provider config'],
			['404 Not Found', 'provider config'],
			['[GoogleGenerativeAI Error]: [404 Not Found] models/gemini-1.5-flash is not found', 'provider config'],
			['[GoogleGenerativeAI Error]: models/gemini-2.0-flash is no longer available to new users', 'provider config'],
			['The model has been deprecated and is no longer supported', 'provider config'],
		])('should detect resource-not-found error: "%s"', (errorMsg, expectedPrefix) => {
			const result = isProviderFatalError(new Error(errorMsg));
			expect(result).not.toBeNull();
			expect(result).toContain(expectedPrefix);
		});

		it.each([
			'Invalid prompt: content policy violation',
			'Maximum token limit reached',
			'Invalid API key format',
			'Unsupported content type',
			'',
		])('should return null for non-provider error: "%s"', (errorMsg) => {
			expect(isProviderFatalError(new Error(errorMsg))).toBeNull();
		});

		it('should handle non-Error objects', () => {
			expect(isProviderFatalError('string error with 429')).not.toBeNull();
			// Plain objects without Error prototype are stringified via String() → [object Object]
			// so they won't match patterns — only Error instances get .message extracted
			expect(isProviderFatalError({ message: '503' })).toBeNull();
			expect(isProviderFatalError(null)).toBeNull();
			expect(isProviderFatalError(undefined)).toBeNull();
		});

		it('should check error.code and error.status fields', () => {
			const errorWithCode = new Error('Something went wrong');
			(errorWithCode as unknown as Record<string, unknown>).status = 429;
			expect(isProviderFatalError(errorWithCode)).not.toBeNull();

			const errorWithStatus = new Error('Unknown');
			(errorWithStatus as unknown as Record<string, unknown>).code = '503';
			expect(isProviderFatalError(errorWithStatus)).not.toBeNull();
		});
	});

	// ── Fallback on _generate() (internal langchain method) ──

	it('should fallback on _generate() method', async () => {
		process.env.GOOGLE_AI_API_KEY = 'gk';
		process.env.OPENAI_API_KEY = 'ok';

		createModelSpy.mockImplementation(
			(_ctx: unknown, provider: string, _apiKey: string, modelName: string) => ({
				_mockModel: true,
				provider,
				model: modelName,
				invoke: async () => ({ content: `Response from ${provider}` }),
				_generate: async () => {
					if (provider === 'google') {
						throw new Error('The resource you are requesting could not be found');
					}
					return { generations: [[{ text: `Response from ${provider}` }]] };
				},
			}),
		);

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		const model = result.response as {
			_generate: (msgs: unknown[], opts: unknown) => Promise<unknown>;
		};
		const response = await model._generate([], {});
		expect(response).toEqual({ generations: [[{ text: 'Response from openai' }]] });
	});

	// ── Fallback on batch() ──

	it('should fallback on batch() method', async () => {
		process.env.GOOGLE_AI_API_KEY = 'gk';
		process.env.OPENAI_API_KEY = 'ok';

		createModelSpy.mockImplementation(
			(_ctx: unknown, provider: string, _apiKey: string, modelName: string) => ({
				_mockModel: true,
				provider,
				model: modelName,
				invoke: async () => ({ content: `Response from ${provider}` }),
				batch: async () => {
					if (provider === 'google') {
						throw new Error('exceeded your current quota');
					}
					return [{ content: `Batch from ${provider}` }];
				},
			}),
		);

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		const model = result.response as {
			batch: (inputs: unknown[]) => Promise<unknown>;
		};
		const response = await model.batch(['Hello', 'World']);
		expect(response).toEqual([{ content: 'Batch from openai' }]);
	});

	// ── Fallback on stream() (async generator) ──

	it('should fallback on stream() async generator', async () => {
		process.env.OPENAI_API_KEY = 'ok';
		process.env.ANTHROPIC_API_KEY = 'ak';

		createModelSpy.mockImplementation(
			(_ctx: unknown, provider: string, _apiKey: string, modelName: string) => ({
				_mockModel: true,
				provider,
				model: modelName,
				invoke: async () => ({ content: `Response from ${provider}` }),
				async *stream() {
					if (provider === 'openai') {
						throw new Error('503 Service Unavailable');
					}
					yield { content: 'streamed-chunk' };
				},
			}),
		);

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		const model = result.response as {
			stream: (msg: string) => AsyncGenerator<unknown>;
		};
		const chunks: unknown[] = [];
		for await (const chunk of model.stream('Hello')) {
			chunks.push(chunk);
		}
		expect(chunks).toEqual([{ content: 'streamed-chunk' }]);
	});

	// ── withConfig preserves fallback ──

	it('should preserve fallback behavior after withConfig', async () => {
		process.env.OPENAI_API_KEY = 'ok';
		process.env.ANTHROPIC_API_KEY = 'ak';

		createModelSpy.mockImplementation(
			(_ctx: unknown, provider: string, _apiKey: string, modelName: string) => ({
				_mockModel: true,
				provider,
				model: modelName,
				withConfig: (cfg: unknown) => ({
					provider,
					_config: cfg,
					invoke: async () => {
						if (provider === 'openai') {
							throw new Error('429 Too Many Requests');
						}
						return { content: `Configured response from ${provider}` };
					},
				}),
			}),
		);

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		const model = result.response as {
			withConfig: (cfg: unknown) => { invoke: (msg: string) => Promise<unknown> };
		};
		const configured = model.withConfig({ tags: ['test'] });
		const response = await configured.invoke('Hello');
		expect(response).toEqual({ content: 'Configured response from anthropic' });
	});

	// ── Sticky fallback (subsequent calls use fallback) ──

	it('should use fallback provider for subsequent calls after first failure', async () => {
		process.env.GOOGLE_AI_API_KEY = 'gk';
		process.env.OPENAI_API_KEY = 'ok';

		const callLog: string[] = [];
		createModelSpy.mockImplementation(
			(_ctx: unknown, provider: string, _apiKey: string, modelName: string) => ({
				_mockModel: true,
				provider,
				model: modelName,
				invoke: async (msg: unknown) => {
					callLog.push(provider);
					if (provider === 'google') {
						throw new Error('exceeded your current quota');
					}
					return { content: `Response from ${provider}` };
				},
			}),
		);

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		const model = result.response as { invoke: (msg: string) => Promise<unknown> };

		// First call — triggers fallback
		await model.invoke('First');
		expect(callLog).toEqual(['google', 'openai']);

		// Second call — should go directly to openai (sticky)
		callLog.length = 0;
		await model.invoke('Second');
		expect(callLog).toEqual(['openai']);
	});

	// ── Fallback notification includes from/to/reason details ──

	it('should include provider details in fallback notification', async () => {
		process.env.GOOGLE_AI_API_KEY = 'gk';
		process.env.OPENAI_API_KEY = 'ok';

		createModelSpy.mockImplementation(
			(_ctx: unknown, provider: string, _apiKey: string, modelName: string) => ({
				_mockModel: true,
				provider,
				model: modelName,
				invoke: async () => {
					if (provider === 'google') {
						throw new Error('The resource you are requesting could not be found');
					}
					return { content: `Response from ${provider}` };
				},
			}),
		);

		const ctx = createMockSupplyDataFunctions({
			routingStrategy: 'auto',
			modelOverride: '',
			options: {},
		});

		const node = new AishaLlmRouter();
		const result = await node.supplyData.call(ctx, 0);

		const model = result.response as { invoke: (msg: string) => Promise<unknown> };
		await model.invoke('Hello');

		// Verify the fallback notification has from, to, and reason
		expect(ctx.sendMessageToUI).toHaveBeenCalledWith(
			expect.stringMatching(/google.*failed.*openai/i),
		);
	});
});
