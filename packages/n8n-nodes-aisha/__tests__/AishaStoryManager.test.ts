import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AishaStoryManager } from '../nodes/AishaStoryManager/AishaStoryManager.node';
import { createMockExecuteFunctions, setupFetchMock, mockFetchResponse } from './helpers/mockFactory';

describe('AishaStoryManager', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.restoreAllMocks();
		fetchMock = setupFetchMock({ id: 'story-1', status: 'in_progress' });
	});

	it('should have correct node description', () => {
		const node = new AishaStoryManager();
		expect(node.description.name).toBe('aishaStoryManager');
		expect(node.description.version).toBe(1);
	});

	it('should have all 8 operations', () => {
		const node = new AishaStoryManager();
		const opProp = node.description.properties.find((p) => p.name === 'operation');
		const options = (opProp as { options?: Array<{ value: string }> })?.options ?? [];
		expect(options).toHaveLength(8);
		const values = options.map((o) => o.value);
		expect(values).toContain('getContext');
		expect(values).toContain('transitionStatus');
		expect(values).toContain('getAllowedTransitions');
		expect(values).toContain('getTimeline');
		expect(values).toContain('manageEnvironment');
		expect(values).toContain('getEnvironments');
		expect(values).toContain('createRuleset');
		expect(values).toContain('estimateEffort');
	});

	it('should execute getContext operation', async () => {
		fetchMock.mockResolvedValue(
			mockFetchResponse({ story_id: 's1', context: 'full delivery context' }),
		);

		const ctx = createMockExecuteFunctions({
			operation: 'getContext',
			storyId: 'story-abc',
		});

		const node = new AishaStoryManager();
		const result = await node.execute.call(ctx);

		expect(result[0]).toHaveLength(1);
		expect(fetchMock).toHaveBeenCalled();

		const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toContain('/rest/v1/rpc/mcp_get_story_context');
	});

	it('should execute transitionStatus with correct params', async () => {
		const ctx = createMockExecuteFunctions({
			operation: 'transitionStatus',
			storyId: 'story-xyz',
			targetStatus: 'in_review',
			reason: 'All tests passing',
		});

		const node = new AishaStoryManager();
		await node.execute.call(ctx);

		const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(options.body as string) as Record<string, unknown>;
		expect(body.p_story_id).toBe('story-xyz');
		expect(body.p_new_status).toBe('in_review');
		expect(body.p_trigger_source).toBe('All tests passing');
	});

	it('should execute manageEnvironment operation', async () => {
		const ctx = createMockExecuteFunctions({
			operation: 'manageEnvironment',
			storyId: 'story-env',
			envName: 'staging',
			envConfig: '{"branch": "feature/test"}',
		});

		const node = new AishaStoryManager();
		await node.execute.call(ctx);

		const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toContain('/rest/v1/rpc/upsert_story_environment');

		const body = JSON.parse(options.body as string) as Record<string, unknown>;
		expect(body.p_story_id).toBe('story-env');
		expect(body.p_environment).toBe('staging');
		expect(body.p_branch).toBe('feature/test');
	});

	it('should execute estimateEffort with task description', async () => {
		fetchMock.mockResolvedValue(
			mockFetchResponse({ estimate_hours: 8, confidence: 0.75 }),
		);

		const ctx = createMockExecuteFunctions({
			operation: 'estimateEffort',
			storyId: 'story-est',
			taskDescription: 'Implement user authentication with OAuth2',
		});

		const node = new AishaStoryManager();
		const result = await node.execute.call(ctx);

		expect(result[0][0].json).toBeDefined();

		const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(options.body as string) as Record<string, unknown>;
		expect(body.p_session_id).toBe('story-est');
		expect(body.p_task_description).toBe('Implement user authentication with OAuth2');
		expect(body.p_affected_files).toEqual([]);
		expect(body.p_complexity_factors).toEqual({});
	});

	it('should handle RPC errors with continueOnFail', async () => {
		fetchMock.mockResolvedValue(mockFetchResponse({ message: 'Not found' }, false));

		const ctx = createMockExecuteFunctions({
			operation: 'getContext',
			storyId: 'nonexistent',
			continueOnFail: true,
		});

		const node = new AishaStoryManager();
		const result = await node.execute.call(ctx);

		expect(result[0][0].json).toHaveProperty('error');
	});
});
