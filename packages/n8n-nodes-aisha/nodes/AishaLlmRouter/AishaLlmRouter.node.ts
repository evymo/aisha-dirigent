import type {
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
	IDataObject,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

// ─── Error classification helpers ─────────────────────────────────────────

/** Error codes / messages that indicate quota or billing issues (non-transient). */
const QUOTA_ERROR_PATTERNS = [
	'exceeded your current quota',
	'insufficient_quota',
	'billing',
	'rate_limit',
	'rate limit',
	'429',
	'quota',
	'RateLimitError',
	'insufficient funds',
	'payment required',
	'402',
	'too many requests',
] as const;

/** Error patterns indicating the provider is temporarily or permanently down. */
const PROVIDER_DOWN_PATTERNS = [
	'503',
	'502',
	'service unavailable',
	'overloaded',
	'server error',
	'500',
	'ECONNREFUSED',
	'ETIMEDOUT',
	'network error',
] as const;

/** Error patterns indicating an unavailable model/resource for current provider. */
const RESOURCE_NOT_FOUND_PATTERNS = [
	'the resource you are requesting could not be found',
	'model not found',
	'does not exist',
	'is no longer available',
	'has been deprecated',
	'404',
] as const;

/**
 * Check if an error indicates the provider should be skipped (quota/billing/down).
 * Returns the matched reason string or null.
 *
 * @internal Exported for testing only.
 */
export function isProviderFatalError(error: unknown): string | null {
	const msg = error instanceof Error
		? `${error.message} ${(error as unknown as Record<string, unknown>).code ?? ''} ${(error as unknown as Record<string, unknown>).status ?? ''}`
		: String(error);
	const lower = msg.toLowerCase();

	for (const pattern of QUOTA_ERROR_PATTERNS) {
		if (lower.includes(pattern.toLowerCase())) return `quota/billing: ${pattern}`;
	}
	for (const pattern of PROVIDER_DOWN_PATTERNS) {
		if (lower.includes(pattern.toLowerCase())) return `provider down: ${pattern}`;
	}
	for (const pattern of RESOURCE_NOT_FOUND_PATTERNS) {
		if (lower.includes(pattern.toLowerCase())) return `provider config: ${pattern}`;
	}
	return null;
}

// ─── FallbackChatModel — langchain-compatible wrapper with provider failover ──

// ─── Provider Probing System ──────────────────────────────────────────
// Lightweight runtime capability probes that test providers before selection.
// Each task type has a specific probe prompt + response validator.
// Results are cached in-process with TTL to avoid redundant API calls.

/** Probe result for a single provider + task combination. */
interface ProbeResult {
	provider: string;
	available: boolean;
	latencyMs: number;
	/** 0-100 quality score based on response validation. */
	qualityScore: number;
	/** Combined score: quality (50%) + speed (30%) + availability (20%). */
	totalScore: number;
	timestamp: number;
}

/** Task-specific probe prompt with response validator. */
interface ProbePrompt {
	message: string;
	/** Returns 0-100 quality score based on response content. */
	validator: (response: string) => number;
}

/** In-memory cache for probe results. Key: `${provider}:${taskHint}`. */
const probeCache = new Map<string, ProbeResult>();

/** Cache TTL in milliseconds (10 minutes). */
const PROBE_CACHE_TTL_MS = 10 * 60 * 1000;

/** Maximum time to wait for a single probe response (ms). */
const PROBE_TIMEOUT_MS = 15_000;

/** Latency ceiling for speed scoring — anything above gets 0 speed points. */
const PROBE_MAX_LATENCY_MS = 10_000;

/**
 * Probe prompts per task type.
 * Each probe is designed to be cheap (~20 input tokens, ~30 output tokens)
 * while testing the specific capability that matters for the task.
 */
const PROBE_PROMPTS: Record<string, ProbePrompt> = {
	coding: {
		message: 'Write a TypeScript function add(a: number, b: number): number that returns their sum. Reply with ONLY the code.',
		validator: (r: string) => {
			let score = 0;
			const lower = r.toLowerCase();
			if (lower.includes('function') || lower.includes('=>')) score += 30;
			if (lower.includes('number')) score += 20;
			if (lower.includes('return')) score += 20;
			if (lower.includes('a + b') || lower.includes('a+b')) score += 30;
			return Math.min(score, 100);
		},
	},
	reasoning: {
		message: 'What is 17 * 23? Reply with ONLY the number, nothing else.',
		validator: (r: string) => r.trim().includes('391') ? 100 : 0,
	},
	fast_response: {
		message: 'Reply with exactly one word: OK',
		validator: (r: string) => r.trim().toLowerCase().startsWith('ok') ? 100 : 50,
	},
	general: {
		message: 'Reply with exactly one word: OK',
		validator: (r: string) => r.trim().toLowerCase().startsWith('ok') ? 100 : 50,
	},
};

/**
 * Extract text content from a langchain model response.
 * Handles both string content and structured MessageContent arrays.
 *
 * @internal Exported for testing only.
 */
export function extractProbeContent(response: unknown): string {
	if (response == null) return '';
	if (typeof response === 'string') return response;
	if (typeof response === 'object' && 'content' in (response as Record<string, unknown>)) {
		const content = (response as { content: unknown }).content;
		if (typeof content === 'string') return content;
		if (Array.isArray(content)) {
			return content
				.map((c) => (typeof c === 'string' ? c : (c as { text?: string }).text ?? ''))
				.join('');
		}
	}
	return String(response);
}

// ─── FallbackChatModel (continued) ────────────────────────────────────

/**
 * Provider factory: creates a langchain model on demand.
 * Deferred so we only instantiate the fallback model if the primary fails.
 */
interface ProviderFactory {
	provider: string;
	model: string;
	create: () => unknown;
}

/**
 * FallbackChatModel wraps a primary langchain model and a list of fallback
 * provider factories. If the primary model's API call fails with a
 * quota/billing/availability error, it transparently creates and delegates
 * to the next available provider.
 *
 * Implements the same interface as langchain BaseChatModel by proxying all
 * property access and method calls to the active underlying model.
 */
function createFallbackProxy(
	primaryModel: unknown,
	primaryProvider: string,
	fallbacks: ProviderFactory[],
	onFallback: (from: string, to: string, reason: string) => void,
): unknown {
	let activeModel = primaryModel;
	let activeProvider = primaryProvider;
	let fallbackIndex = 0;

	/**
	 * Wrap an async method so that on provider-fatal errors it swaps to the
	 * next fallback and retries the call once.
	 */
	function wrapAsyncMethod(methodName: string): (...args: unknown[]) => Promise<unknown> {
		return async function (this: unknown, ...args: unknown[]): Promise<unknown> {
			try {
				const fn = (activeModel as Record<string, unknown>)[methodName];
				if (typeof fn === 'function') {
					return await (fn as (...a: unknown[]) => Promise<unknown>).apply(activeModel, args);
				}
				throw new Error(`Method ${methodName} not found on model`);
			} catch (error: unknown) {
				const reason = isProviderFatalError(error);
				if (!reason || fallbackIndex >= fallbacks.length) {
					throw error; // Not a provider error or no more fallbacks
				}

				// Switch to next fallback
				const fb = fallbacks[fallbackIndex++];
				const fromProvider = activeProvider;
				try {
					activeModel = fb.create();
					activeProvider = fb.provider;
					onFallback(fromProvider, `${fb.provider}/${fb.model}`, reason);

					// Retry the call with the new model
					const fn = (activeModel as Record<string, unknown>)[methodName];
					if (typeof fn === 'function') {
						return await (fn as (...a: unknown[]) => Promise<unknown>).apply(activeModel, args);
					}
					throw new Error(`Method ${methodName} not found on fallback model`);
				} catch (fbError: unknown) {
					// If fallback also fails with provider error and we have more fallbacks, try next
					const fbReason = isProviderFatalError(fbError);
					if (fbReason && fallbackIndex < fallbacks.length) {
						const fb2 = fallbacks[fallbackIndex++];
						activeModel = fb2.create();
						activeProvider = fb2.provider;
						onFallback(fb.provider, `${fb2.provider}/${fb2.model}`, fbReason);

						const fn2 = (activeModel as Record<string, unknown>)[methodName];
						if (typeof fn2 === 'function') {
							return await (fn2 as (...a: unknown[]) => Promise<unknown>).apply(activeModel, args);
						}
					}
					throw fbError;
				}
			}
		};
	}

	/**
	 * Wrap an async generator method (like _streamResponseChunks) so that on
	 * provider-fatal errors it swaps to the next fallback and retries.
	 */
	function wrapAsyncGenerator(methodName: string): (...args: unknown[]) => AsyncGenerator<unknown> {
		return async function* (this: unknown, ...args: unknown[]): AsyncGenerator<unknown> {
			try {
				const fn = (activeModel as Record<string, unknown>)[methodName];
				if (typeof fn === 'function') {
					yield* (fn as (...a: unknown[]) => AsyncGenerator<unknown>).apply(activeModel, args);
					return;
				}
				throw new Error(`Method ${methodName} not found on model`);
			} catch (error: unknown) {
				const reason = isProviderFatalError(error);
				if (!reason || fallbackIndex >= fallbacks.length) {
					throw error;
				}

				const fb = fallbacks[fallbackIndex++];
				const fromProvider = activeProvider;
				activeModel = fb.create();
				activeProvider = fb.provider;
				onFallback(fromProvider, `${fb.provider}/${fb.model}`, reason);

				const fn = (activeModel as Record<string, unknown>)[methodName];
				if (typeof fn === 'function') {
					yield* (fn as (...a: unknown[]) => AsyncGenerator<unknown>).apply(activeModel, args);
					return;
				}
				throw new Error(`Method ${methodName} not found on fallback model`);
			}
		};
	}

	/**
	 * Wrap methods that return a new model-like object (for example bindTools).
	 * We re-wrap returned models so fallback behavior is preserved through chains.
	 */
	function wrapModelReturningMethod(methodName: string): (...args: unknown[]) => unknown {
		return function (this: unknown, ...args: unknown[]): unknown {
			const fn = (activeModel as Record<string, unknown>)[methodName];
			if (typeof fn !== 'function') {
				throw new Error(`Method ${methodName} not found on model`);
			}

			const nextModel = (fn as (...a: unknown[]) => unknown).apply(activeModel, args);
			if (nextModel && (typeof nextModel === 'object' || typeof nextModel === 'function')) {
				const transformedFallbacks = fallbacks.slice(fallbackIndex).map((fb) => ({
					provider: fb.provider,
					model: fb.model,
					create: () => {
						const base = fb.create();
						if (!base || (typeof base !== 'object' && typeof base !== 'function')) {
							return base;
						}
						const chained = (base as Record<string, unknown>)[methodName];
						if (typeof chained === 'function') {
							return (chained as (...a: unknown[]) => unknown).apply(base, args);
						}
						return base;
					},
				}));

				return createFallbackProxy(
					nextModel,
					activeProvider,
					transformedFallbacks,
					onFallback,
				);
			}
			return nextModel;
		};
	}

	// Methods that make API calls and need fallback wrapping
	const ASYNC_METHODS = [
		'invoke', 'generate', '_generate',
		'call', 'predict', 'predictMessages',
		'batch',
	];

	// Async generator methods (yield chunks, must be async generators)
	const ASYNC_GENERATOR_METHODS = [
		'_streamResponseChunks', '_streamIterator', 'stream',
	];

	// Methods that return another model/runnable and must preserve fallback wrapper
	const MODEL_RETURNING_METHODS = [
		'bindTools', 'withConfig',
	];

	// Create a Proxy that intercepts method calls
	return new Proxy(primaryModel as object, {
		get(target, prop, receiver) {
			if (typeof prop === 'string') {
				if (MODEL_RETURNING_METHODS.includes(prop)) {
					const original = Reflect.get(activeModel as object, prop, activeModel);
					if (typeof original === 'function') {
						return wrapModelReturningMethod(prop);
					}
				}
				// Async generator methods need special wrapping
				if (ASYNC_GENERATOR_METHODS.includes(prop)) {
					const original = Reflect.get(activeModel as object, prop, activeModel);
					if (typeof original === 'function') {
						return wrapAsyncGenerator(prop);
					}
				}
				// Regular async API methods
				if (ASYNC_METHODS.includes(prop)) {
					const original = Reflect.get(activeModel as object, prop, activeModel);
					if (typeof original === 'function') {
						return wrapAsyncMethod(prop);
					}
				}
			}
			// For everything else, delegate to the active model (may have changed)
			return Reflect.get(activeModel as object, prop, activeModel);
		},
	});
}

/**
 * AishaLlmRouter — Centralized multi-provider LLM node for AISHA agents.
 *
 * This node implements the `ai_languageModel` interface, meaning it can be
 * plugged into ANY n8n Agent node as its language model sub-node.
 *
 * At runtime it:
 * 1. Resolves which provider to use (auto / explicit / env-based)
 * 2. Checks available API credentials (env vars or n8n credentials)
 * 3. Instantiates the correct langchain ChatModel
 * 4. Wraps it in FallbackChatModel proxy for automatic provider failover
 * 5. Returns it via supplyData() — the Agent node gets a resilient model instance
 *
 * Provider fallback: If the primary provider returns a quota/billing/availability
 * error (429, 402, 503, etc.), the model transparently switches to the next
 * available provider. This ensures AISHA agents remain autonomous even when
 * a single LLM provider has issues.
 *
 * Adding a new provider = editing THIS ONE FILE. No workflow changes needed.
 *
 * Supported providers:
 * - Google Gemini (gemini-2.5-flash, gemini-pro) — via @langchain/google-genai
 * - OpenAI (gpt-4o, gpt-4o-mini) — via @langchain/openai
 * - Anthropic (claude-3.5-sonnet) — via @langchain/anthropic
 * - xAI / Grok (grok-3-mini) — via @langchain/openai (OpenAI-compatible API) [disabled]
 *
 * Runtime dependencies (available in n8n container, NOT bundled):
 * - @langchain/openai
 * - @langchain/google-genai
 * - @langchain/anthropic
 * - @n8n/ai-utilities (N8nLlmTracing, makeN8nLlmFailedAttemptHandler)
 */
export class AishaLlmRouter implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AISHA LLM Router',
		name: 'aishaLlmRouter',
		icon: 'file:../AishaRpc/aisha.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["routingStrategy"] === "explicit" ? $parameter["explicitProvider"] : $parameter["routingStrategy"] }}',
		description:
			'Centralized LLM provider — auto-selects the best available model. Drop-in replacement for OpenAI/Gemini model nodes.',
		defaults: {
			name: 'LLM Router',
		},
		// This is the key: output type is ai_languageModel, so Agent nodes can consume it
		inputs: [],
		outputs: ['ai_languageModel'],
		outputNames: ['Model'],
		credentials: [
			{
				name: 'openAiApi',
				required: false,
			},
			{
				name: 'googlePalmApi',
				required: false,
			},
			{
				name: 'anthropicApi',
				required: false,
			},
		],
		properties: [
			// ── Routing Strategy ──
			{
				displayName: 'Routing Strategy',
				name: 'routingStrategy',
				type: 'options',
				options: [
					{
						name: 'Auto (Best Available)',
						value: 'auto',
						description:
							'Detect available API keys and pick the best provider. Priority: Google → OpenAI → Anthropic.',
					},
					{
						name: 'Explicit Provider',
						value: 'explicit',
						description: 'Always use a specific provider',
					},
				],
				default: 'auto',
			},
			// ── Explicit Provider ──
			{
				displayName: 'Provider',
				name: 'explicitProvider',
				type: 'options',
				displayOptions: { show: { routingStrategy: ['explicit'] } },
				options: [
					{ name: 'Google Gemini', value: 'google' },
					{ name: 'OpenAI', value: 'openai' },
					{ name: 'Anthropic', value: 'anthropic' },
					{ name: 'xAI (Grok)', value: 'xai', description: 'Uses OpenAI-compatible API. Pending model evaluation.' },
				],
				default: 'google',
				required: true,
			},
			// ── Task Hint ──
			{
				displayName: 'Task Hint',
				name: 'taskHint',
				type: 'options',
				displayOptions: { show: { routingStrategy: ['auto'] } },
				options: [
					{
						name: 'General (Default)',
						value: 'general',
						description:
							'Balanced cost/performance. Priority: Google → OpenAI → Anthropic.',
					},
					{
						name: 'Coding',
						value: 'coding',
						description:
							'Code generation, review, refactoring. Priority: Anthropic → OpenAI → Google.',
					},
					{
						name: 'Reasoning',
						value: 'reasoning',
						description:
							'Complex analysis, planning, deep thinking. Priority: Anthropic → Google → OpenAI.',
					},
					{
						name: 'Fast Response',
						value: 'fast_response',
						description:
							'Chat, simple queries, low-latency. Priority: Google → OpenAI → Anthropic.',
					},
				],
				default: 'general',
				description: 'Hint about the task type — reorders provider priority to pick the best available model for the job.',
			},
			// ── Model Override ──
			{
				displayName: 'Model Override',
				name: 'modelOverride',
				type: 'string',
				default: '',
				placeholder: 'e.g. gemini-2.5-flash, gpt-4o, claude-3-5-sonnet-20241022',
				description:
					'Leave empty to use provider default. Override to select a specific model.',
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
						displayName: 'Temperature',
						name: 'temperature',
						type: 'number',
						default: 0.4,
						typeOptions: { minValue: 0, maxValue: 2, numberPrecision: 1 },
						description: 'Controls randomness of the output',
					},
					{
						displayName: 'Max Output Tokens',
						name: 'maxOutputTokens',
						type: 'number',
						default: 2048,
						typeOptions: { minValue: 1 },
						description: 'Maximum number of tokens to generate',
					},
					{
						displayName: 'Top P',
						name: 'topP',
						type: 'number',
						default: 0.9,
						typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
						description: 'Nucleus sampling threshold',
					},
					{
						displayName: 'Max Retries',
						name: 'maxRetries',
						type: 'number',
						default: 2,
						typeOptions: { minValue: 0, maxValue: 10 },
						description: 'Number of retries on transient failures',
					},
					{
						displayName: 'Enable Probing',
						name: 'enableProbing',
						type: 'boolean',
						default: false,
						description:
							'When enabled, runs lightweight capability probes against available providers before selecting. ' +
							'Probes test actual response quality for the selected task type (coding accuracy, reasoning correctness, latency). ' +
							'Results cached for 10 minutes. Adds 1-5s startup latency on first call.',
					},
					{
						displayName: 'Probe Cache TTL (minutes)',
						name: 'probeCacheTtlMinutes',
						type: 'number',
						default: 10,
						typeOptions: { minValue: 1, maxValue: 60 },
						displayOptions: { show: { enableProbing: [true] } },
						description: 'How long to cache probe results before re-testing providers',
					},
				],
			},
		],
	};

	/**
	 * Default provider priority for auto-detection.
	 * Order: Local (if configured) → Google (cheap & fast) → OpenAI (reliable) → Anthropic (quality).
	 * NOTE: xAI is NOT in auto-detection — pending model evaluation.
	 * Once benchmarks confirm quality/reliability, add 'xai' to this array.
	 */
	private static readonly PROVIDER_PRIORITY = ['local', 'google', 'openai', 'anthropic'] as const;

	/**
	 * Task-aware provider priority maps.
	 * Each task hint reorders providers based on which is best suited.
	 * Providers not in the list are still used as fallback (appended in default order).
	 * Configurable via LLM_TASK_PRIORITY_* env vars (JSON arrays).
	 */
	private static readonly TASK_PRIORITY: Record<string, readonly string[]> = (() => {
		const p = (key: string, fallback: string[]): readonly string[] => {
			const raw = process.env[key];
			if (raw) {
				try {
					return JSON.parse(raw);
				} catch (e) {
					console.warn(`[AishaLlmRouter] Invalid JSON in ${key}: ${e}`);
				}
			}
			return fallback;
		};
		return {
			coding: p('LLM_TASK_PRIORITY_CODING', ['anthropic', 'openai', 'google', 'local']),
			reasoning: p('LLM_TASK_PRIORITY_REASONING', ['anthropic', 'google', 'openai', 'local']),
			fast_response: p('LLM_TASK_PRIORITY_FAST', ['local', 'google', 'openai', 'anthropic']),
			general: p('LLM_TASK_PRIORITY_GENERAL', ['local', 'google', 'openai', 'anthropic']),
		};
	})();

	/**
	 * Default models per provider.
	 */
	private static readonly DEFAULT_MODELS: Record<string, string> = {
		local: process.env.LLM_DEFAULT_MODEL_LOCAL ?? 'llama3.1',
		google: process.env.LLM_DEFAULT_MODEL_GOOGLE ?? 'gemini-2.5-flash',
		openai: process.env.LLM_DEFAULT_MODEL_OPENAI ?? 'gpt-4o-mini',
		anthropic: process.env.LLM_DEFAULT_MODEL_ANTHROPIC ?? 'claude-3-5-sonnet-20241022',
		xai: process.env.LLM_DEFAULT_MODEL_XAI ?? 'grok-3-mini',
	};

	/**
	 * Environment variable names per provider (for auto-detection).
	 */
	private static readonly ENV_KEYS: Record<string, string> = {
		local: 'LOCAL_LLM_API_KEY',
		google: 'GOOGLE_AI_API_KEY',
		openai: 'OPENAI_API_KEY',
		anthropic: 'ANTHROPIC_API_KEY',
		xai: 'XAI_API_KEY',
	};

	/** Local OpenAI-compatible base URL (vLLM/Ollama proxy/etc.) */
	private static readonly LOCAL_BASE_URL_ENV = 'LOCAL_LLM_BASE_URL';
	/** Optional local model override (if DEFAULT_MODELS.local is not valid) */
	private static readonly LOCAL_MODEL_ENV = 'LOCAL_LLM_MODEL';

	/**
	 * n8n credential type names per provider.
	 */
	private static readonly CREDENTIAL_TYPES: Record<string, string> = {
		google: 'googlePalmApi',
		openai: 'openAiApi',
		anthropic: 'anthropicApi',
		xai: 'openAiApi',
	};

	/**
	 * Resolve which API key to use for a provider.
	 * Tries n8n credential first, then falls back to env var.
	 */
	private static async resolveApiKey(
		ctx: ISupplyDataFunctions,
		provider: string,
	): Promise<{ apiKey: string; source: 'credential' | 'env' } | null> {
		// Local provider is OpenAI-compatible but may not require a real key.
		// We consider it "available" when LOCAL_LLM_BASE_URL is set.
		if (provider === 'local') {
			const baseUrl = (process.env[AishaLlmRouter.LOCAL_BASE_URL_ENV] ?? '').trim();
			if (!baseUrl) return null;
			const envKey = AishaLlmRouter.ENV_KEYS.local;
			const apiKey = (process.env[envKey] ?? '').trim() || 'local';
			return { apiKey, source: 'env' };
		}

		// 1. Try n8n credential
		const credType = AishaLlmRouter.CREDENTIAL_TYPES[provider];
		if (credType) {
			try {
				const creds = await ctx.getCredentials(credType);
				if (creds?.apiKey && String(creds.apiKey).trim()) {
					return { apiKey: String(creds.apiKey), source: 'credential' };
				}
			} catch {
				// Credential not configured — fall through to env
			}
		}

		// 2. Try environment variable
		const envKey = AishaLlmRouter.ENV_KEYS[provider];
		if (envKey) {
			const envVal = process.env[envKey];
			if (envVal && envVal.trim()) {
				return { apiKey: envVal.trim(), source: 'env' };
			}
		}

		return null;
	}

	/**
	 * Get provider priority order based on task hint.
	 * Falls back to default PROVIDER_PRIORITY for unknown hints.
	 */
	private static getProviderPriority(taskHint?: string): readonly string[] {
		if (taskHint && taskHint in AishaLlmRouter.TASK_PRIORITY) {
			return AishaLlmRouter.TASK_PRIORITY[taskHint];
		}
		return AishaLlmRouter.PROVIDER_PRIORITY;
	}

	/**
	 * Probe a single provider's capability for a specific task type.
	 * Sends a lightweight test prompt, measures latency, and validates response quality.
	 * Results are cached with TTL to avoid redundant API calls.
	 *
	 * @param cacheTtlMs - Override cache TTL (default: PROBE_CACHE_TTL_MS)
	 */
	private static async probeProvider(
		ctx: ISupplyDataFunctions,
		provider: string,
		apiKey: string,
		taskHint: string,
		cacheTtlMs?: number,
	): Promise<ProbeResult> {
		const ttl = cacheTtlMs ?? PROBE_CACHE_TTL_MS;
		const cacheKey = `${provider}:${taskHint}`;
		const cached = probeCache.get(cacheKey);
		if (cached && (Date.now() - cached.timestamp) < ttl) {
			return cached;
		}

		const probe = PROBE_PROMPTS[taskHint] ?? PROBE_PROMPTS.general;
		const modelName = AishaLlmRouter.DEFAULT_MODELS[provider] || process.env.FALLBACK_LLM_MODEL || 'gpt-4o';

		const start = Date.now();
		try {
			const model = AishaLlmRouter.createModel(ctx, provider, apiKey, modelName, {
				temperature: 0,
				maxOutputTokens: 100,
				maxRetries: 0,
			});

			// Race against timeout — if provider is too slow, fail gracefully
			const response = await Promise.race([
				(model as { invoke: (msg: string) => Promise<unknown> }).invoke(probe.message),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('Probe timeout')), PROBE_TIMEOUT_MS),
				),
			]);

			const latencyMs = Date.now() - start;
			const content = extractProbeContent(response);
			const qualityScore = probe.validator(content);
			const speedScore = Math.max(0, Math.round(100 - (latencyMs / PROBE_MAX_LATENCY_MS) * 100));
			// Weights: quality 50%, speed 30%, availability 20% (always 20 if response received)
			const totalScore = Math.round(qualityScore * 0.5 + speedScore * 0.3 + 20);

			const result: ProbeResult = {
				provider,
				available: true,
				latencyMs,
				qualityScore,
				totalScore,
				timestamp: Date.now(),
			};
			probeCache.set(cacheKey, result);
			return result;
		} catch (probeErr) {
			console.warn(`[AishaLlmRouter] probe failed for ${provider}, caching as unavailable:`, probeErr);
			const result: ProbeResult = {
				provider,
				available: false,
				latencyMs: Date.now() - start,
				qualityScore: 0,
				totalScore: 0,
				timestamp: Date.now(),
			};
			// Cache failures too — prevents hammering an unavailable provider
			probeCache.set(cacheKey, result);
			return result;
		}
	}

	/**
	 * Probe all available providers in parallel and rank by combined score.
	 * Returns providers sorted best-first, with unavailable providers excluded.
	 */
	private static async probeAndRank(
		ctx: ISupplyDataFunctions,
		providers: Array<{ provider: string; apiKey: string; source: 'credential' | 'env' }>,
		taskHint: string,
		cacheTtlMs?: number,
	): Promise<Array<{ provider: string; apiKey: string; source: 'credential' | 'env'; probeScore: number; probeLatencyMs: number; probeQuality: number }>> {
		const results = await Promise.all(
			providers.map(async (p) => {
				const probe = await AishaLlmRouter.probeProvider(ctx, p.provider, p.apiKey, taskHint, cacheTtlMs);
				return {
					...p,
					probeScore: probe.totalScore,
					probeLatencyMs: probe.latencyMs,
					probeQuality: probe.qualityScore,
				};
			}),
		);

		// Sort by total score descending (best first), exclude unavailable (score 0)
		return results
			.filter((r) => r.probeScore > 0)
			.sort((a, b) => b.probeScore - a.probeScore);
	}

	/**
	 * Auto-detect which provider to use based on available API keys.
	 * Returns the first provider with a valid key, following task-aware priority order.
	 */
	private static async autoDetectProvider(
		ctx: ISupplyDataFunctions,
		taskHint?: string,
	): Promise<{ provider: string; apiKey: string; source: 'credential' | 'env' }> {
		const priority = AishaLlmRouter.getProviderPriority(taskHint);
		for (const provider of priority) {
			const result = await AishaLlmRouter.resolveApiKey(ctx, provider);
			if (result) {
				return { provider, ...result };
			}
		}

		throw new NodeOperationError(
			ctx.getNode(),
			'No LLM provider available. Configure at least one: ' +
				'LOCAL_LLM_BASE_URL (optional local), GOOGLE_AI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or XAI_API_KEY (env), ' +
				'or set up n8n credentials (googlePalmApi, openAiApi, anthropicApi).',
		);
	}

	/**
	 * Instantiate the correct langchain ChatModel for the resolved provider.
	 *
	 * Uses dynamic require() because @langchain/* packages are available
	 * at n8n runtime but not bundled with this custom node package.
	 */
	private static createModel(
		ctx: ISupplyDataFunctions,
		provider: string,
		apiKey: string,
		modelName: string,
		options: IDataObject,
	): unknown {
		// Import n8n's tracing utilities for LLM call observability
		let N8nLlmTracing: (new (ctx: unknown, opts?: unknown) => unknown) | undefined;
		let makeN8nLlmFailedAttemptHandler:
			| ((ctx: unknown, handler?: unknown) => (error: unknown) => void)
			| undefined;

		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const aiUtils = require('@n8n/ai-utilities') as {
				N8nLlmTracing: typeof N8nLlmTracing;
				makeN8nLlmFailedAttemptHandler: typeof makeN8nLlmFailedAttemptHandler;
			};
			N8nLlmTracing = aiUtils.N8nLlmTracing;
			makeN8nLlmFailedAttemptHandler = aiUtils.makeN8nLlmFailedAttemptHandler;
		} catch {
			// ai-utilities not available — proceed without tracing
		}

		const callbacks = N8nLlmTracing ? [new N8nLlmTracing(ctx)] : [];

		// Wrap onFailedAttempt so it never throws — n8n's handler may throw
		// NodeApiError which short-circuits langchain's retry and bypasses
		// our FallbackChatModel proxy error handling.
		const rawHandler = makeN8nLlmFailedAttemptHandler
			? makeN8nLlmFailedAttemptHandler(ctx)
			: undefined;
		const onFailedAttempt = rawHandler
			? (error: unknown) => { try { rawHandler(error); } catch { /* let error propagate to proxy */ } }
			: undefined;

		const temperature = (options.temperature as number) ?? 0.4;
		const maxRetries = (options.maxRetries as number) ?? 2;

		switch (provider) {
			case 'local': {
				// Local inference via OpenAI-compatible API (vLLM / LiteLLM / proxy).
				const baseURL = (process.env[AishaLlmRouter.LOCAL_BASE_URL_ENV] ?? '').trim();
				if (!baseURL) {
					throw new NodeOperationError(ctx.getNode(), 'LOCAL_LLM_BASE_URL is required for provider=local.');
				}
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				const { ChatOpenAI } = require('@langchain/openai') as {
					ChatOpenAI: new (config: Record<string, unknown>) => unknown;
				};
				return new ChatOpenAI({
					openAIApiKey: apiKey,
					model: modelName,
					temperature,
					maxTokens: (options.maxOutputTokens as number) ?? 2048,
					topP: (options.topP as number) ?? 0.9,
					maxRetries,
					callbacks,
					onFailedAttempt,
					configuration: { baseURL },
				});
			}

			case 'google': {
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				const { ChatGoogleGenerativeAI } = require('@langchain/google-genai') as {
					ChatGoogleGenerativeAI: new (config: Record<string, unknown>) => unknown;
				};
				return new ChatGoogleGenerativeAI({
					apiKey,
					model: modelName,
					temperature,
					maxOutputTokens: (options.maxOutputTokens as number) ?? 2048,
					topP: (options.topP as number) ?? 0.9,
					callbacks,
					onFailedAttempt,
				});
			}

			case 'openai': {
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				const { ChatOpenAI } = require('@langchain/openai') as {
					ChatOpenAI: new (config: Record<string, unknown>) => unknown;
				};
				return new ChatOpenAI({
					apiKey,
					model: modelName,
					temperature,
					maxTokens: (options.maxOutputTokens as number) ?? 2048,
					topP: (options.topP as number) ?? 0.9,
					maxRetries,
					callbacks,
					onFailedAttempt,
				});
			}

			case 'anthropic': {
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				const { ChatAnthropic } = require('@langchain/anthropic') as {
					ChatAnthropic: new (config: Record<string, unknown>) => unknown;
				};
				return new ChatAnthropic({
					anthropicApiKey: apiKey,
					model: modelName,
					temperature,
					maxTokens: (options.maxOutputTokens as number) ?? 2048,
					topP: (options.topP as number) ?? 0.9,
					maxRetries,
					callbacks,
					onFailedAttempt,
				});
			}

			case 'xai': {
				// xAI uses an OpenAI-compatible API at https://api.x.ai/v1
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				const { ChatOpenAI } = require('@langchain/openai') as {
					ChatOpenAI: new (config: Record<string, unknown>) => unknown;
				};
				return new ChatOpenAI({
					openAIApiKey: apiKey,
					model: modelName,
					temperature,
					maxTokens: (options.maxOutputTokens as number) ?? 2048,
					topP: (options.topP as number) ?? 0.9,
					maxRetries,
					callbacks,
					onFailedAttempt,
					configuration: {
						baseURL: 'https://api.x.ai/v1',
					},
				});
			}

			default:
				throw new NodeOperationError(
					ctx.getNode(),
					`Unsupported provider: ${provider}. Supported: local, google, openai, anthropic, xai.`,
				);
		}
	}

	/**
	 * Collect all available providers with their API keys (excluding skipProvider).
	 * Used to build the fallback chain. Respects task-aware priority order.
	 */
	private static async collectAvailableProviders(
		ctx: ISupplyDataFunctions,
		skipProvider?: string,
		taskHint?: string,
	): Promise<Array<{ provider: string; apiKey: string; source: 'credential' | 'env' }>> {
		const priority = AishaLlmRouter.getProviderPriority(taskHint);
		const results: Array<{ provider: string; apiKey: string; source: 'credential' | 'env' }> = [];
		for (const provider of priority) {
			if (provider === skipProvider) continue;
			const resolved = await AishaLlmRouter.resolveApiKey(ctx, provider);
			if (resolved) {
				results.push({ provider, ...resolved });
			}
		}
		return results;
	}

	/**
	 * supplyData() — the core interface for ai_languageModel nodes.
	 *
	 * Called by the Agent node to get a langchain BaseChatModel instance.
	 * The Agent then uses this model for its iterative tool-calling loop.
	 *
	 * The returned model is wrapped in a FallbackChatModel proxy that
	 * automatically switches to the next available provider on quota/billing
	 * errors (429, 402, etc.), ensuring AISHA agents stay operational.
	 */
	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const strategy = this.getNodeParameter('routingStrategy', itemIndex) as string;
		const modelOverride = this.getNodeParameter('modelOverride', itemIndex, '') as string;
		const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
		const taskHint = strategy === 'auto'
			? (this.getNodeParameter('taskHint', itemIndex, 'general') as string)
			: undefined;
		const enableProbing = (options.enableProbing as boolean) ?? false;
		const probeCacheTtlMinutes = (options.probeCacheTtlMinutes as number) ?? 10;
		const probeCacheTtlMs = probeCacheTtlMinutes * 60 * 1000;

		let provider: string;
		let apiKey: string;
		let source: 'credential' | 'env';
		let probeInfo = '';

		if (strategy === 'explicit') {
			provider = this.getNodeParameter('explicitProvider', itemIndex) as string;
			const resolved = await AishaLlmRouter.resolveApiKey(this, provider);
			if (!resolved) {
				throw new NodeOperationError(
					this.getNode(),
					`Provider '${provider}' selected but no API key found. ` +
						`Set ${AishaLlmRouter.ENV_KEYS[provider]} env var or configure ` +
						`'${AishaLlmRouter.CREDENTIAL_TYPES[provider]}' credential in n8n.`,
				);
			}
			apiKey = resolved.apiKey;
			source = resolved.source;
		} else if (enableProbing && taskHint) {
			// Probe mode: collect ALL available providers, probe them, rank by score
			const allProviders: Array<{ provider: string; apiKey: string; source: 'credential' | 'env' }> = [];
			for (const p of AishaLlmRouter.getProviderPriority(taskHint)) {
				const resolved = await AishaLlmRouter.resolveApiKey(this, p);
				if (resolved) {
					allProviders.push({ provider: p, ...resolved });
				}
			}

			if (allProviders.length === 0) {
				throw new NodeOperationError(
					this.getNode(),
					'No LLM provider available. Configure at least one: ' +
						'GOOGLE_AI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or XAI_API_KEY (env), ' +
						'or set up n8n credentials (googlePalmApi, openAiApi, anthropicApi).',
				);
			}

			const ranked = await AishaLlmRouter.probeAndRank(this, allProviders, taskHint, probeCacheTtlMs);

			if (ranked.length === 0) {
				// All probes failed — fall back to static priority
				const detected = await AishaLlmRouter.autoDetectProvider(this, taskHint);
				provider = detected.provider;
				apiKey = detected.apiKey;
				source = detected.source;
				probeInfo = ' probe=all-failed,static-fallback';
			} else {
				const best = ranked[0];
				provider = best.provider;
				apiKey = best.apiKey;
				source = best.source;
				probeInfo = ` probe=${ranked.map((r) => `${r.provider}:${r.probeScore}`).join(',')}`;
			}
		} else {
			// Auto-detect with task-aware priority (no probing)
			const detected = await AishaLlmRouter.autoDetectProvider(this, taskHint);
			provider = detected.provider;
			apiKey = detected.apiKey;
			source = detected.source;
		}

		let modelName = modelOverride.trim() || AishaLlmRouter.DEFAULT_MODELS[provider] || process.env.FALLBACK_LLM_MODEL || 'gpt-4o';
		if (provider === 'local' && !modelOverride.trim()) {
			const envModel = (process.env[AishaLlmRouter.LOCAL_MODEL_ENV] ?? '').trim();
			if (envModel) modelName = envModel;
		}
		const primaryModel = AishaLlmRouter.createModel(this, provider, apiKey, modelName, options);

		// Build fallback provider chain (all available providers except the primary)
		const fallbackProviders = await AishaLlmRouter.collectAvailableProviders(this, provider, taskHint);

		const fallbackFactories: ProviderFactory[] = fallbackProviders.map((fb) => ({
			provider: fb.provider,
			model: AishaLlmRouter.DEFAULT_MODELS[fb.provider] || process.env.FALLBACK_LLM_MODEL || 'gpt-4o',
			create: () => AishaLlmRouter.createModel(
				this, fb.provider, fb.apiKey,
				AishaLlmRouter.DEFAULT_MODELS[fb.provider] || process.env.FALLBACK_LLM_MODEL || 'gpt-4o',
				options,
			),
		}));

		// Wrap primary model with fallback proxy
		const resilientModel = fallbackFactories.length > 0
			? createFallbackProxy(
				primaryModel,
				provider,
				fallbackFactories,
				(from, to, reason) => {
					this.sendMessageToUI(
						`⚠ LLM Fallback: ${from} failed (${reason}) → switching to ${to}`,
					);
				},
			)
			: primaryModel;

		// Log routing decision for observability (via n8n execution data, not console)
		const fallbackInfo = fallbackFactories.length > 0
			? ` [fallbacks: ${fallbackFactories.map((f) => f.provider).join(' → ')}]`
			: ' [no fallbacks]';
		const taskInfo = taskHint && taskHint !== 'general' ? ` task=${taskHint}` : '';
		this.sendMessageToUI(
			`LLM Router → ${provider}/${modelName} (${source})${taskInfo}${probeInfo}${fallbackInfo}`,
		);

		return {
			response: resilientModel,
			metadata: {
				provider,
				model: modelName,
				source,
				strategy,
				taskHint: taskHint ?? 'none',
				probing: enableProbing,
				fallbackProviders: fallbackFactories.map((f) => f.provider),
			},
		};
	}
}
