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
 * Aisha Model Router Node — Multi-LLM intelligent routing.
 *
 * Routes AI requests to the optimal provider/model based on:
 * - Task risk level (low → Gemini Flash, high → GPT-4o)
 * - Explicit provider hints
 * - Agent model_overrides from DB
 * - Cost/latency trade-offs
 *
 * Replaces the manual Switch + Code node pattern in WF_MODEL_ROUTER
 * with a single configurable node.
 *
 * Providers:
 * - OpenAI (GPT-4o, GPT-4o-mini)
 * - Google (Gemini 2.0 Flash, Gemini Pro)
 * - Anthropic (Claude 3.5 Sonnet)
 * - xAI (Grok) [disabled — pending model evaluation]
 *
 * Output ports: 0=OpenAI, 1=Google, 2=Anthropic, 3=xAI, 4=Fallback
 */
export class AishaModelRouter implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AISHA Model Router',
		name: 'aishaModelRouter',
		icon: 'file:../AishaRpc/aisha.svg',
		group: ['transform'],
		version: 1,
		subtitle: 'Route: {{ $parameter["routingStrategy"] }}',
		description: 'Intelligently route AI requests to optimal LLM provider based on context and risk',
		defaults: {
			name: 'Model Router',
		},
		inputs: ['main'],
		outputs: ['main', 'main', 'main', 'main', 'main'],
		outputNames: ['OpenAI', 'Google', 'Anthropic', 'xAI', 'Fallback'],
		credentials: [
			{
				name: 'aishaPostgrestApi',
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
						name: 'Auto (Risk-Based)',
						value: 'auto',
						description: 'Route based on task risk level and context',
					},
					{
						name: 'Explicit Provider',
						value: 'explicit',
						description: 'Route to a specific provider',
					},
					{
						name: 'Cost Optimized',
						value: 'costOptimized',
						description: 'Always choose cheapest provider that meets quality threshold',
					},
					{
						name: 'Quality First',
						value: 'qualityFirst',
						description: 'Always choose highest quality provider',
					},
					{
						name: 'From DB (Agent Config)',
						value: 'fromDb',
						description: 'Use model_overrides from agent_catalog in DB',
					},
				],
				default: 'auto',
			},
			// ── Task Context ──
			{
				displayName: 'Task',
				name: 'task',
				type: 'string',
				default: '',
				placeholder: '={{ $json.message || $json.task }}',
				description: 'The task/prompt to route',
				required: true,
			},
			// ── Risk Level (for auto) ──
			{
				displayName: 'Risk Level',
				name: 'riskLevel',
				type: 'options',
				displayOptions: { show: { routingStrategy: ['auto'] } },
				options: [
					{ name: 'Low (Fast/Cheap)', value: 'low' },
					{ name: 'Medium (Balanced)', value: 'medium' },
					{ name: 'High (Accuracy)', value: 'high' },
					{ name: 'Critical (Best Available)', value: 'critical' },
				],
				default: 'medium',
			},
			// ── Task Type (for auto) ──
			{
				displayName: 'Task Type',
				name: 'taskType',
				type: 'options',
				displayOptions: { show: { routingStrategy: ['auto'] } },
				options: [
					{ name: 'Chat / Q&A', value: 'chat' },
					{ name: 'Classification', value: 'classification' },
					{ name: 'Code Review', value: 'code_review' },
					{ name: 'Coding / Implementation', value: 'coding' },
					{ name: 'Compliance', value: 'compliance' },
					{ name: 'Creative', value: 'creative' },
					{ name: 'Data Analysis', value: 'data_analysis' },
					{ name: 'General', value: 'general' },
					{ name: 'Reasoning / Deep Thinking', value: 'reasoning' },
					{ name: 'Research', value: 'research' },
					{ name: 'Summarization', value: 'summarization' },
					{ name: 'Translation', value: 'translation' },
					{ name: 'Triage', value: 'triage' },
				],
				default: 'general',
			},
			// ── Explicit Provider ──
			{
				displayName: 'Provider',
				name: 'explicitProvider',
				type: 'options',
				displayOptions: { show: { routingStrategy: ['explicit'] } },
				options: [
					{ name: 'OpenAI', value: 'openai' },
					{ name: 'Google', value: 'google' },
					{ name: 'Anthropic', value: 'anthropic' },
					{ name: 'xAI (Grok)', value: 'xai', description: 'Disabled — pending model evaluation' },
				],
				default: 'openai',
				required: true,
			},
			// ── Agent ID (for DB lookup) ──
			{
				displayName: 'Agent Slug',
				name: 'agentSlug',
				type: 'string',
				displayOptions: { show: { routingStrategy: ['fromDb'] } },
				default: '',
				placeholder: 'dirigent-agent',
				description: 'Agent slug to look up model_overrides from agent_catalog',
			},
		],
	};

	/** Default models per provider — configurable via env vars. Used in routing matrix. */
	private static readonly ROUTE_MODELS: Record<string, string> = {
		openai: process.env.MODEL_ROUTER_OPENAI ?? 'gpt-4o',
		google: process.env.MODEL_ROUTER_GOOGLE ?? 'gemini-2.5-flash',
		anthropic: process.env.MODEL_ROUTER_ANTHROPIC ?? 'claude-sonnet-4-20250514',
		xai: process.env.MODEL_ROUTER_XAI ?? 'grok-3-mini',
	};

	/**
	 * Routing decision matrix.
	 *
	 * Returns output index: 0=OpenAI, 1=Google, 2=Anthropic, 3=xAI, 4=Fallback
	 */
	private static resolveProvider(
		strategy: string,
		riskLevel: string,
		taskType: string,
		explicitProvider: string,
	): { outputIndex: number; provider: string; model: string; reasoning: string } {
		const M = AishaModelRouter.ROUTE_MODELS;

		// Explicit routing
		if (strategy === 'explicit') {
			const map: Record<string, { idx: number; model: string }> = {
				openai: { idx: 0, model: M.openai },
				google: { idx: 1, model: M.google },
				anthropic: { idx: 2, model: M.anthropic },
				xai: { idx: 3, model: M.xai },
			};
			const m = map[explicitProvider] ?? map.openai;
			return {
				outputIndex: m.idx,
				provider: explicitProvider,
				model: m.model,
				reasoning: `Explicit provider selection: ${explicitProvider}`,
			};
		}

		// Cost optimized — always cheapest except critical
		if (strategy === 'costOptimized') {
			if (riskLevel === 'critical') {
				return { outputIndex: 0, provider: 'openai', model: M.openai, reasoning: `Cost optimized: critical → ${M.openai} (minimum quality bar)` };
			}
			return { outputIndex: 1, provider: 'google', model: M.google, reasoning: `Cost optimized: ${M.google} for non-critical` };
		}

		// Quality first — always best available
		if (strategy === 'qualityFirst') {
			return { outputIndex: 0, provider: 'openai', model: M.openai, reasoning: `Quality first: ${M.openai} for maximum accuracy` };
		}

		// Auto: Risk-based routing matrix
		// NOTE: xAI (idx=3) is not in auto matrix — pending model evaluation.
		// Once benchmarks are run, xAI models will be added to appropriate cells.
		const matrix: Record<string, Record<string, { idx: number; provider: string; model: string }>> = {
			low: {
				classification: { idx: 1, provider: 'google', model: M.google },
				triage: { idx: 1, provider: 'google', model: M.google },
				summarization: { idx: 1, provider: 'google', model: M.google },
				translation: { idx: 1, provider: 'google', model: M.google },
				chat: { idx: 1, provider: 'google', model: M.google },
				general: { idx: 1, provider: 'google', model: M.google },
				default: { idx: 1, provider: 'google', model: M.google },
			},
			medium: {
				coding: { idx: 0, provider: 'openai', model: M.openai },
				code_review: { idx: 0, provider: 'openai', model: M.openai },
				compliance: { idx: 0, provider: 'openai', model: M.openai },
				data_analysis: { idx: 0, provider: 'openai', model: M.openai },
				research: { idx: 0, provider: 'openai', model: M.openai },
				reasoning: { idx: 0, provider: 'openai', model: M.openai },
				chat: { idx: 1, provider: 'google', model: M.google },
				general: { idx: 1, provider: 'google', model: M.google },
				default: { idx: 1, provider: 'google', model: M.google },
			},
			high: {
				reasoning: { idx: 2, provider: 'anthropic', model: M.anthropic },
				coding: { idx: 2, provider: 'anthropic', model: M.anthropic },
				default: { idx: 0, provider: 'openai', model: M.openai },
			},
			critical: {
				default: { idx: 0, provider: 'openai', model: M.openai },
			},
		};

		const riskMatrix = matrix[riskLevel] ?? matrix.medium;
		const route = riskMatrix[taskType] ?? riskMatrix.default;

		return {
			outputIndex: route.idx,
			provider: route.provider,
			model: route.model,
			reasoning: `Auto route: risk=${riskLevel}, type=${taskType} → ${route.provider}/${route.model}`,
		};
	}

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const outputs: INodeExecutionData[][] = [[], [], [], [], []]; // OpenAI, Google, Anthropic, xAI, Fallback

		for (let i = 0; i < items.length; i++) {
			try {
				const strategy = this.getNodeParameter('routingStrategy', i) as string;
				const task = this.getNodeParameter('task', i) as string;
				const riskLevel = strategy === 'auto'
					? this.getNodeParameter('riskLevel', i, 'medium') as string
					: 'medium';
				const taskType = strategy === 'auto'
					? this.getNodeParameter('taskType', i, 'general') as string
					: 'general';
				const explicitProvider = strategy === 'explicit'
					? this.getNodeParameter('explicitProvider', i, 'openai') as string
					: 'openai';

				let route: { outputIndex: number; provider: string; model: string; reasoning: string };

				if (strategy === 'fromDb') {
					// Fetch from DB — requires aishaPostgrestApi credential
					const agentSlug = this.getNodeParameter('agentSlug', i) as string;

					// Cat5 fix: validate agentSlug before passing to RPC
					if (!/^[a-z0-9_-]+$/.test(agentSlug)) {
						throw new NodeOperationError(
							this.getNode(),
							`Invalid agentSlug: must match [a-z0-9_-]+, got "${agentSlug}"`,
							{ itemIndex: i },
						);
					}

					let modelOverrides: Record<string, { provider?: string; model?: string }> = {};

					try {
						const credentials = await this.getCredentials('aishaPostgrestApi');
						const cleanUrl = requirePostgrestUrl(credentials, this.getNode()).replace(/\/$/, '');
						const apiKey = requireCredString(credentials, 'serviceRoleKey', this.getNode());

						// Cat1 fix: add timeout to fetch
						const resp = await fetchWithTimeout(`${cleanUrl}/rest/v1/rpc/get_agent_knowledge`, {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json',
								'apikey': apiKey,
								'Authorization': `Bearer ${apiKey}`,
							},
							body: JSON.stringify({ p_agent_slug: agentSlug }),
						});

						if (resp.ok) {
							const agentData = await resp.json() as { model_overrides?: Record<string, { provider?: string; model?: string }> };
							modelOverrides = agentData.model_overrides ?? {};
						}
					} catch (credErr) {
						// Rethrow NodeOperationError (credential validation failures)
						if (credErr instanceof NodeOperationError) throw credErr;
						// DB lookup failed — fall through to auto routing
					}

					const override = modelOverrides[taskType] ?? modelOverrides['default'];
					if (override?.provider) {
						const providerMap: Record<string, number> = { openai: 0, google: 1, anthropic: 2, xai: 3 };
						route = {
							outputIndex: providerMap[override.provider] ?? 3,
							provider: override.provider,
							model: override.model ?? process.env.FALLBACK_LLM_MODEL ?? 'gpt-4o',
							reasoning: `DB route: agent=${agentSlug}, override for ${taskType} → ${override.provider}/${override.model}`,
						};
					} else {
						route = AishaModelRouter.resolveProvider('auto', riskLevel, taskType, explicitProvider);
						route.reasoning += ' (DB fallback)';
					}
				} else {
					route = AishaModelRouter.resolveProvider(strategy, riskLevel, taskType, explicitProvider);
				}

				const outputItem: INodeExecutionData = {
					json: {
						...items[i].json,
						_routing: {
							provider: route.provider,
							model: route.model,
							reasoning: route.reasoning,
							strategy,
							task,
						},
					},
					pairedItem: { item: i },
				};

				outputs[route.outputIndex].push(outputItem);
			} catch (error) {
				if (this.continueOnFail()) {
					const err = error as Error;
					outputs[4].push({
						json: { error: err.message, _routing: { provider: 'fallback', model: 'none', reasoning: 'Error in routing' } },
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
		}

		return outputs;
	}
}
