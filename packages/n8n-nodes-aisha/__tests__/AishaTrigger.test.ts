import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AishaTrigger } from '../nodes/AishaTrigger/AishaTrigger.node';
import { createMockPollFunctions } from './helpers/mockFactory';

describe('AishaTrigger', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('should have correct node description', () => {
		const node = new AishaTrigger();
		expect(node.description.name).toBe('aishaTrigger');
		expect(node.description.version).toBe(1);
		expect(node.description.polling).toBe(true);
		expect(node.description.group).toContain('trigger');
	});

	it('should have all event type options', () => {
		const node = new AishaTrigger();
		const eventProp = node.description.properties.find((p) => p.name === 'eventType');
		const options = (eventProp as { options?: Array<{ value: string }> })?.options ?? [];
		const values = options.map((o) => o.value);

		expect(values).toContain('story_created');
		expect(values).toContain('story_status_changed');
		expect(values).toContain('compliance_result');
		expect(values).toContain('escalation');
		expect(values).toContain('audit_anomaly');
		expect(values).toContain('node_factory_request');
		expect(values).toContain('agent_registered');
		expect(values).toContain('custom_rpc');
	});

	it('should return events on poll', async () => {
		const ctx = createMockPollFunctions({
			eventType: 'story_created',
			dedupField: 'id',
			maxEvents: 25,
		});

		// Mock httpRequest on helpers
		vi.mocked(ctx.helpers.httpRequest).mockResolvedValue([
			{ id: 'story-1', title: 'New Story', created_at: '2025-01-01T00:00:00Z' },
			{ id: 'story-2', title: 'Another Story', created_at: '2025-01-01T01:00:00Z' },
		]);

		const node = new AishaTrigger();
		const result = await node.poll.call(ctx);

		expect(result).not.toBeNull();
		expect(result?.[0]).toHaveLength(2);
		expect(result?.[0][0].json.id).toBe('story-1');
		expect(result?.[0][0].json._trigger).toEqual(
			expect.objectContaining({ eventType: 'story_created' }),
		);
	});

	it('should deduplicate events seen before', async () => {
		const staticData: Record<string, unknown> = { seenIds: ['story-1'], lastPollDate: '2025-01-01T00:00:00Z' };

		const ctx = createMockPollFunctions({
			eventType: 'story_created',
			dedupField: 'id',
			maxEvents: 25,
		});
		vi.mocked(ctx.getWorkflowStaticData).mockReturnValue(staticData);

		vi.mocked(ctx.helpers.httpRequest).mockResolvedValue([
			{ id: 'story-1', title: 'Already Seen', created_at: '2025-01-01T00:00:00Z' },
			{ id: 'story-3', title: 'New Story', created_at: '2025-01-01T02:00:00Z' },
		]);

		const node = new AishaTrigger();
		const result = await node.poll.call(ctx);

		// Should only return story-3, not story-1
		expect(result?.[0]).toHaveLength(1);
		expect(result?.[0][0].json.id).toBe('story-3');
	});

	it('should return null when no new events', async () => {
		const ctx = createMockPollFunctions({
			eventType: 'story_created',
			dedupField: 'id',
			maxEvents: 25,
		});

		vi.mocked(ctx.helpers.httpRequest).mockResolvedValue([]);

		const node = new AishaTrigger();
		const result = await node.poll.call(ctx);

		expect(result).toBeNull();
	});

	it('should filter story_status_changed by status', async () => {
		const ctx = createMockPollFunctions({
			eventType: 'story_status_changed',
			dedupField: 'id',
			maxEvents: 25,
			statusFilter: 'blocked,stuck',
		});

		vi.mocked(ctx.helpers.httpRequest).mockResolvedValue([
			{ id: '1', status: 'in_progress' },
			{ id: '2', status: 'blocked' },
			{ id: '3', status: 'stuck' },
		]);

		const node = new AishaTrigger();
		const result = await node.poll.call(ctx);

		// Only blocked and stuck should pass
		expect(result?.[0]).toHaveLength(2);
		const statuses = result?.[0].map((e) => e.json.status);
		expect(statuses).toEqual(['blocked', 'stuck']);
	});

	it('should filter escalations by severity', async () => {
		const ctx = createMockPollFunctions({
			eventType: 'escalation',
			dedupField: 'id',
			maxEvents: 25,
			severityFilter: 'error',
		});

		vi.mocked(ctx.helpers.httpRequest).mockResolvedValue([
			{ id: '1', severity: 'info' },
			{ id: '2', severity: 'warning' },
			{ id: '3', severity: 'error' },
		]);

		const node = new AishaTrigger();
		const result = await node.poll.call(ctx);

		expect(result?.[0]).toHaveLength(1);
		expect(result?.[0][0].json.severity).toBe('error');
	});

	it('should handle custom RPC event type', async () => {
		const ctx = createMockPollFunctions({
			eventType: 'custom_rpc',
			dedupField: 'id',
			maxEvents: 10,
			customRpcFunction: 'my_custom_poll',
			customRpcParams: '{"p_status": "pending"}',
		});

		vi.mocked(ctx.helpers.httpRequest).mockResolvedValue([
			{ id: 'custom-1', status: 'pending' },
		]);

		const node = new AishaTrigger();
		const result = await node.poll.call(ctx);

		expect(result?.[0]).toHaveLength(1);

		// Verify httpRequest was called with the custom function
		expect(ctx.helpers.httpRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				url: expect.stringContaining('/rest/v1/rpc/my_custom_poll'),
			}),
		);
	});

	it('should handle RPC failures gracefully', async () => {
		const ctx = createMockPollFunctions({
			eventType: 'story_created',
			dedupField: 'id',
			maxEvents: 25,
		});

		vi.mocked(ctx.helpers.httpRequest).mockRejectedValue(new Error('Network timeout'));

		const node = new AishaTrigger();
		const result = await node.poll.call(ctx);

		// Should return null, not throw
		expect(result).toBeNull();
	});

	it('should limit dedup storage to 500 IDs', async () => {
		const existingIds = Array.from({ length: 499 }, (_, i) => `old-${i}`);
		const staticData: Record<string, unknown> = { seenIds: existingIds };

		const ctx = createMockPollFunctions({
			eventType: 'story_created',
			dedupField: 'id',
			maxEvents: 25,
		});
		vi.mocked(ctx.getWorkflowStaticData).mockReturnValue(staticData);

		vi.mocked(ctx.helpers.httpRequest).mockResolvedValue([
			{ id: 'new-1' },
			{ id: 'new-2' },
			{ id: 'new-3' },
		]);

		const node = new AishaTrigger();
		await node.poll.call(ctx);

		const seenIds = staticData.seenIds as string[];
		expect(seenIds.length).toBeLessThanOrEqual(500);
		// New IDs should be at the end
		expect(seenIds[seenIds.length - 1]).toBe('new-3');
	});
});
