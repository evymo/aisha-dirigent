import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AishaAudit } from '../nodes/AishaAudit/AishaAudit.node';
import { createMockExecuteFunctions, setupFetchMock, mockFetchResponse } from './helpers/mockFactory';

describe('AishaAudit', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.restoreAllMocks();
		fetchMock = setupFetchMock({ success: true });
	});

	it('should have correct node description', () => {
		const node = new AishaAudit();
		expect(node.description.name).toBe('aishaAudit');
		expect(node.description.version).toBe(1);
		expect(node.description.group).toContain('output');
	});

	it('should have all audit action types', () => {
		const node = new AishaAudit();
		const actionProp = node.description.properties.find((p) => p.name === 'action');
		expect(actionProp?.type).toBe('options');
		// Should have standard audit actions
		const options = (actionProp as { options?: Array<{ value: string }> })?.options ?? [];
		const values = options.map((o) => o.value);
		expect(values).toContain('AGENT_INVOKED');
		expect(values).toContain('COMPLIANCE_CHECK');
		expect(values).toContain('NODE_FACTORY_GENERATE');
	});

	it('should write audit entry via RPC', async () => {
		const ctx = createMockExecuteFunctions({
			action: 'AGENT_INVOKED',
			area: 'orchestration',
			severity: 'info',
			entityType: '',
			entityId: '',
			extraMetadata: '{}',
		});

		const node = new AishaAudit();
		const result = await node.execute.call(ctx);

		expect(result[0]).toHaveLength(1);
		expect(fetchMock).toHaveBeenCalled();

		const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toContain('/rest/v1/rpc/write_audit_journal');

		const body = JSON.parse(options.body as string) as Record<string, unknown>;
		expect(body.p_action_type).toBe('AGENT_INVOKED');
	});

	it('should include metadata with workflow context', async () => {
		const ctx = createMockExecuteFunctions({
			action: 'COMPLIANCE_CHECK',
			area: 'delivery',
			severity: 'warning',
			entityType: 'story',
			entityId: 'story-abc-123',
			metadata: '{"check_type": "pr_review"}',
			userId: '',
		});

		const node = new AishaAudit();
		await node.execute.call(ctx);

		const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(options.body as string) as {
			p_area: string;
			p_severity: string;
			p_entity_type: string;
			p_entity_id: string | null;
			p_details: Record<string, unknown>;
		};

		expect(body.p_area).toBe('delivery');
		expect(body.p_severity).toBe('warning');
		expect(body.p_entity_type).toBe('story');
		expect(body.p_entity_id).toBe('story-abc-123');
		expect(body.p_details.workflow_id).toBe('test-workflow-id');
		expect(body.p_details.check_type).toBe('pr_review');
	});

	it('should fail fast when write_audit_journal RPC fails', async () => {
		fetchMock.mockResolvedValueOnce(
			mockFetchResponse({ message: 'RPC not found' }, false),
		);

		const ctx = createMockExecuteFunctions({
			action: 'AGENT_INVOKED',
			area: 'orchestration',
			severity: 'info',
			entityType: '',
			entityId: '',
			extraMetadata: '{}',
		});

		const node = new AishaAudit();
		await expect(node.execute.call(ctx)).rejects.toThrow(
			/write_audit_journal RPC/,
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('should handle both failures gracefully with continueOnFail', async () => {
		fetchMock.mockResolvedValue(mockFetchResponse({ message: 'Error' }, false));

		const ctx = createMockExecuteFunctions({
			action: 'AGENT_INVOKED',
			area: 'orchestration',
			severity: 'info',
			entityType: '',
			entityId: '',
			extraMetadata: '{}',
			continueOnFail: true,
		});

		const node = new AishaAudit();
		const result = await node.execute.call(ctx);

		expect(result[0][0].json).toHaveProperty('error');
	});
});
