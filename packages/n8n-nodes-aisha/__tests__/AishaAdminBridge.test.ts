import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AishaAdminBridge } from '../nodes/AishaAdminBridge/AishaAdminBridge.node';
import { createMockExecuteFunctions, setupFetchMock, mockFetchResponse } from './helpers/mockFactory';

describe('AishaAdminBridge', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.restoreAllMocks();
		fetchMock = setupFetchMock({ success: true });
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Node Description
	// ═══════════════════════════════════════════════════════════════════════

	it('should have correct node description', () => {
		const node = new AishaAdminBridge();
		expect(node.description.name).toBe('aishaAdminBridge');
		expect(node.description.version).toBe(1);
		expect(node.description.displayName).toBe('AISHA Admin Bridge');
	});

	it('should have 5 service options', () => {
		const node = new AishaAdminBridge();
		const serviceProp = node.description.properties.find((p) => p.name === 'service');
		const options = (serviceProp as { options?: Array<{ value: string }> })?.options ?? [];
		expect(options.map((o) => o.value)).toEqual(['nocodb', 'langfuse', 'forgejo', 'appsmith', 'health']);
	});

	it('should have NocoDB operations', () => {
		const node = new AishaAdminBridge();
		const opProps = node.description.properties.filter((p) => p.name === 'operation');
		const nocodbOp = opProps.find((p) =>
			(p.displayOptions as { show?: Record<string, string[]> })?.show?.service?.includes('nocodb'),
		);
		const options = (nocodbOp as { options?: Array<{ value: string }> })?.options ?? [];
		const values = options.map((o) => o.value);
		expect(values).toContain('list_tables');
		expect(values).toContain('get_schema');
		expect(values).toContain('list_records');
		expect(values).toContain('create_record');
		expect(values).toContain('update_record');
		expect(values).toContain('delete_record');
		expect(values).toContain('create_view');
		expect(values).toContain('run_formula');
	});

	it('should have Langfuse operations', () => {
		const node = new AishaAdminBridge();
		const opProps = node.description.properties.filter((p) => p.name === 'operation');
		const langfuseOp = opProps.find((p) =>
			(p.displayOptions as { show?: Record<string, string[]> })?.show?.service?.includes('langfuse'),
		);
		const options = (langfuseOp as { options?: Array<{ value: string }> })?.options ?? [];
		const values = options.map((o) => o.value);
		expect(values).toContain('get_traces');
		expect(values).toContain('get_sessions');
		expect(values).toContain('get_metrics');
		expect(values).toContain('create_score');
		expect(values).toContain('get_generations');
		expect(values).toContain('get_datasets');
	});

	it('should require aishaNocoDbApi credentials for NocoDB', () => {
		const node = new AishaAdminBridge();
		const cred = node.description.credentials?.find((c) => c.name === 'aishaNocoDbApi');
		expect(cred).toBeDefined();
		expect((cred?.displayOptions as { show?: Record<string, string[]> })?.show?.service).toEqual(['nocodb']);
	});

	it('should require aishaLangfuseApi credentials for Langfuse', () => {
		const node = new AishaAdminBridge();
		const cred = node.description.credentials?.find((c) => c.name === 'aishaLangfuseApi');
		expect(cred).toBeDefined();
		expect((cred?.displayOptions as { show?: Record<string, string[]> })?.show?.service).toEqual(['langfuse']);
	});

	// ═══════════════════════════════════════════════════════════════════════
	// NocoDB Operations
	// ═══════════════════════════════════════════════════════════════════════

	describe('NocoDB operations', () => {
		const nocoDbCredentials = {
			aishaNocoDbApi: {
				baseUrl: 'https://nocodb.test.local',
				apiToken: 'test-nocodb-token',
			},
		};

		it('should list tables', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse({ list: [{ id: 'tbl1', title: 'test_table' }] }));

			const ctx = createMockExecuteFunctions({
				service: 'nocodb',
				operation: 'list_tables',
				credentials: nocoDbCredentials,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(result[0][0].json.operation).toBe('list_tables');
			expect(fetchMock).toHaveBeenCalledWith(
				'https://nocodb.test.local/api/v1/meta/bases',
				expect.objectContaining({
					headers: expect.objectContaining({ 'xc-token': 'test-nocodb-token' }),
				}),
			);
		});

		it('should get table schema', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse({ columns: [{ title: 'id', uidt: 'ID' }] }));

			const ctx = createMockExecuteFunctions({
				service: 'nocodb',
				operation: 'get_schema',
				tableId: 'tbl_abc123',
				credentials: nocoDbCredentials,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(result[0][0].json.tableId).toBe('tbl_abc123');
			expect(fetchMock).toHaveBeenCalledWith(
				'https://nocodb.test.local/api/v1/meta/tables/tbl_abc123',
				expect.anything(),
			);
		});

		it('should list records with pagination', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse({ list: [], pageInfo: { totalRows: 0 } }));

			const ctx = createMockExecuteFunctions({
				service: 'nocodb',
				operation: 'list_records',
				tableId: 'tbl_abc123',
				limit: 10,
				offset: 20,
				where: '(status,eq,active)',
				credentials: nocoDbCredentials,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining('limit=10'),
				expect.anything(),
			);
			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining('offset=20'),
				expect.anything(),
			);
			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining('where='),
				expect.anything(),
			);
		});

		it('should create a record', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse({ Id: 1, Title: 'New Record' }));

			const ctx = createMockExecuteFunctions({
				service: 'nocodb',
				operation: 'create_record',
				tableId: 'tbl_abc123',
				recordData: { Title: 'New Record' },
				credentials: nocoDbCredentials,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(fetchMock).toHaveBeenCalledWith(
				'https://nocodb.test.local/api/v1/db/data/noco/tbl_abc123',
				expect.objectContaining({ method: 'POST' }),
			);
		});

		it('should update a record', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse({ Id: 1 }));

			const ctx = createMockExecuteFunctions({
				service: 'nocodb',
				operation: 'update_record',
				tableId: 'tbl_abc123',
				recordId: '1',
				recordData: { Title: 'Updated' },
				credentials: nocoDbCredentials,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(fetchMock).toHaveBeenCalledWith(
				'https://nocodb.test.local/api/v1/db/data/noco/tbl_abc123/1',
				expect.objectContaining({ method: 'PATCH' }),
			);
		});

		it('should delete a record', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse({ msg: 'Deleted' }));

			const ctx = createMockExecuteFunctions({
				service: 'nocodb',
				operation: 'delete_record',
				tableId: 'tbl_abc123',
				recordId: '42',
				credentials: nocoDbCredentials,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(result[0][0].json.recordId).toBe('42');
			expect(fetchMock).toHaveBeenCalledWith(
				'https://nocodb.test.local/api/v1/db/data/noco/tbl_abc123/42',
				expect.objectContaining({ method: 'DELETE' }),
			);
		});

		it('should create a view', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse({ id: 'vw_123', title: 'New View' }));

			const ctx = createMockExecuteFunctions({
				service: 'nocodb',
				operation: 'create_view',
				tableId: 'tbl_abc123',
				viewName: 'Active Records',
				viewType: 'kanban',
				credentials: nocoDbCredentials,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(result[0][0].json.viewType).toBe('kanban');
			expect(fetchMock).toHaveBeenCalledWith(
				'https://nocodb.test.local/api/v1/meta/tables/tbl_abc123/views',
				expect.objectContaining({ method: 'POST' }),
			);
		});

		it('should handle API errors gracefully', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse('Not Found', false));

			const ctx = createMockExecuteFunctions({
				service: 'nocodb',
				operation: 'list_tables',
				credentials: nocoDbCredentials,
				continueOnFail: true,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.error).toBeDefined();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Langfuse Operations
	// ═══════════════════════════════════════════════════════════════════════

	describe('Langfuse operations', () => {
		const langfuseCredentials = {
			aishaLangfuseApi: {
				host: 'https://langfuse.test.local',
				publicKey: 'pk-test',
				secretKey: 'sk-test',
			},
		};

		it('should get traces', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse({ data: [{ id: 'trace-1' }] }));

			const ctx = createMockExecuteFunctions({
				service: 'langfuse',
				operation: 'get_traces',
				traceName: 'aisha-orchestration',
				langfuseLimit: 10,
				credentials: langfuseCredentials,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(result[0][0].json.operation).toBe('get_traces');
			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining('/api/public/traces'),
				expect.objectContaining({
					headers: expect.objectContaining({
						'Authorization': expect.stringContaining('Basic'),
					}),
				}),
			);
		});

		it('should get sessions', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse({ data: [] }));

			const ctx = createMockExecuteFunctions({
				service: 'langfuse',
				operation: 'get_sessions',
				langfuseLimit: 20,
				credentials: langfuseCredentials,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining('/api/public/sessions'),
				expect.anything(),
			);
		});

		it('should get metrics', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse({ data: { totalCost: 12.5 } }));

			const ctx = createMockExecuteFunctions({
				service: 'langfuse',
				operation: 'get_metrics',
				langfuseLimit: 50,
				credentials: langfuseCredentials,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(result[0][0].json.operation).toBe('get_metrics');
		});

		it('should create a score', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse({ id: 'score-1' }));

			const ctx = createMockExecuteFunctions({
				service: 'langfuse',
				operation: 'create_score',
				traceId: 'trace-abc',
				scoreName: 'quality',
				scoreValue: 0.95,
				langfuseLimit: 50,
				credentials: langfuseCredentials,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(result[0][0].json.traceId).toBe('trace-abc');
			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining('/api/public/scores'),
				expect.objectContaining({ method: 'POST' }),
			);
		});

		it('should get generations', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse({ data: [{ model: 'gpt-4' }] }));

			const ctx = createMockExecuteFunctions({
				service: 'langfuse',
				operation: 'get_generations',
				traceName: '',
				langfuseLimit: 25,
				credentials: langfuseCredentials,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining('/api/public/generations'),
				expect.anything(),
			);
		});

		it('should get datasets', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse({ data: [] }));

			const ctx = createMockExecuteFunctions({
				service: 'langfuse',
				operation: 'get_datasets',
				langfuseLimit: 10,
				credentials: langfuseCredentials,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining('/api/public/datasets'),
				expect.anything(),
			);
		});

		it('should use Basic auth with proper encoding', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse({ data: [] }));

			const ctx = createMockExecuteFunctions({
				service: 'langfuse',
				operation: 'get_traces',
				traceName: '',
				langfuseLimit: 50,
				credentials: langfuseCredentials,
			});

			const node = new AishaAdminBridge();
			await node.execute.call(ctx);

			const expectedAuth = 'Basic ' + Buffer.from('pk-test:sk-test').toString('base64');
			expect(fetchMock).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					headers: expect.objectContaining({ Authorization: expectedAuth }),
				}),
			);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Health Check Operations
	// ═══════════════════════════════════════════════════════════════════════

	describe('Health check operations', () => {
		it('should check all services', async () => {
			// Mock multiple fetch calls: Supabase RPC returns URLs, then health checks for each
			fetchMock
				.mockResolvedValueOnce(mockFetchResponse([
					{ service_name: 'nocodb', base_url: 'https://nocodb.test.local' },
					{ service_name: 'langfuse', base_url: 'https://langfuse.test.local' },
					{ service_name: 'forgejo', base_url: 'https://forgejo.test.local' },
					{ service_name: 'appsmith', base_url: 'https://appsmith.test.local' },
					{ service_name: 'n8n', base_url: 'https://n8n.test.local' },
				]))
				.mockResolvedValueOnce(mockFetchResponse({ status: 'ok' }))  // nocodb
				.mockResolvedValueOnce(mockFetchResponse({ status: 'ok' }))  // langfuse
				.mockResolvedValueOnce(mockFetchResponse({ status: 'ok' }))  // forgejo
				.mockResolvedValueOnce(mockFetchResponse({ status: 'ok' }))  // appsmith
				.mockResolvedValueOnce(mockFetchResponse({ status: 'ok' })); // n8n

			const ctx = createMockExecuteFunctions({
				service: 'health',
				operation: 'check_all',
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(result[0][0].json.operation).toBe('check_all');
			const services = result[0][0].json.services as Array<{ service: string; status: string }>;
			expect(services).toHaveLength(5);
		});

		it('should check single service', async () => {
			// First call: Supabase RPC for URLs
			// Second call: nocodb credential attempt
			// Third call: health check
			fetchMock
				.mockResolvedValueOnce(mockFetchResponse([
					{ service_name: 'nocodb', base_url: 'https://nocodb.test.local' },
				]))
				.mockResolvedValueOnce(mockFetchResponse({ status: 'ok' }));

			const ctx = createMockExecuteFunctions({
				service: 'health',
				operation: 'check_one',
				serviceName: 'nocodb',
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			const json = result[0][0].json;
			expect(json.service).toBe('nocodb');
		});

		it('should handle service down gracefully', async () => {
			fetchMock
				.mockRejectedValueOnce(new Error('Supabase unavailable'))  // RPC fails
				.mockRejectedValueOnce(new Error('Connection refused'));    // NocoDB down

			const ctx = createMockExecuteFunctions({
				service: 'health',
				operation: 'check_one',
				serviceName: 'nocodb',
				credentials: {
					aishaNocoDbApi: {
						baseUrl: 'https://nocodb.test.local',
						apiToken: 'test',
					},
				},
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			const json = result[0][0].json;
			expect(json.service).toBe('nocodb');
			expect(json.status).toBe('down');
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Error Handling
	// ═══════════════════════════════════════════════════════════════════════

	describe('Error handling', () => {
		it('should handle unknown service with continueOnFail', async () => {
			const ctx = createMockExecuteFunctions({
				service: 'unknown_service',
				operation: 'test',
				continueOnFail: true,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.error).toBeDefined();
			expect(result[0][0].json.service).toBe('unknown_service');
		});

		it('should throw for unknown service without continueOnFail', async () => {
			const ctx = createMockExecuteFunctions({
				service: 'unknown_service',
				operation: 'test',
				continueOnFail: false,
			});

			const node = new AishaAdminBridge();
			await expect(node.execute.call(ctx)).rejects.toThrow();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Appsmith Operations
	// ═══════════════════════════════════════════════════════════════════════

	describe('Appsmith operations', () => {
		const appsmithCredentials = {
			aishaAppsmithApi: {
				baseUrl: 'https://appsmith.test.local',
				apiKey: 'test-appsmith-key',
			},
		};

		it('should have correct Appsmith operations', () => {
			const node = new AishaAdminBridge();
			const opProps = node.description.properties.filter((p) => p.name === 'operation');
			const appsmithOp = opProps.find((p) =>
				(p.displayOptions as { show?: Record<string, string[]> })?.show?.service?.includes('appsmith'),
			);
			const options = (appsmithOp as { options?: Array<{ value: string }> })?.options ?? [];
			const values = options.map((o) => o.value);
			expect(values).toEqual(['list_pages', 'get_page', 'update_page', 'deploy_app', 'git_sync']);
		});

		it('should require aishaAppsmithApi credentials for Appsmith', () => {
			const node = new AishaAdminBridge();
			const cred = node.description.credentials?.find((c) => c.name === 'aishaAppsmithApi');
			expect(cred).toBeDefined();
			expect((cred?.displayOptions as { show?: Record<string, string[]> })?.show?.service).toEqual(['appsmith']);
		});

		it('should list pages for an application', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse({
				data: [{ id: 'page1', name: 'Home' }, { id: 'page2', name: 'Stories' }],
			}));

			const ctx = createMockExecuteFunctions({
				service: 'appsmith',
				operation: 'list_pages',
				applicationId: 'app-123',
				credentials: appsmithCredentials,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(result[0][0].json.operation).toBe('list_pages');
			expect(fetchMock).toHaveBeenCalledWith(
				'https://appsmith.test.local/api/v1/pages?applicationId=app-123',
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: 'Bearer test-appsmith-key',
					}),
				}),
			);
		});

		it('should get page details', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse({
				data: { id: 'page1', name: 'Home', layouts: [] },
			}));

			const ctx = createMockExecuteFunctions({
				service: 'appsmith',
				operation: 'get_page',
				pageId: 'page-abc',
				credentials: appsmithCredentials,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(fetchMock).toHaveBeenCalledWith(
				'https://appsmith.test.local/api/v1/pages/page-abc',
				expect.anything(),
			);
		});

		it('should update page layout', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse({ data: { id: 'page1' } }));

			const ctx = createMockExecuteFunctions({
				service: 'appsmith',
				operation: 'update_page',
				pageId: 'page-abc',
				pageLayout: JSON.stringify({ widgetName: 'MainContainer', type: 'CANVAS_WIDGET' }),
				credentials: appsmithCredentials,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(fetchMock).toHaveBeenCalledWith(
				'https://appsmith.test.local/api/v1/layouts/page-abc',
				expect.objectContaining({
					method: 'PUT',
					body: expect.stringContaining('MainContainer'),
				}),
			);
		});

		it('should deploy application', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse({ data: { isPublished: true } }));

			const ctx = createMockExecuteFunctions({
				service: 'appsmith',
				operation: 'deploy_app',
				applicationId: 'app-123',
				credentials: appsmithCredentials,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(fetchMock).toHaveBeenCalledWith(
				'https://appsmith.test.local/api/v1/applications/deploy/app-123',
				expect.objectContaining({ method: 'POST' }),
			);
		});

		it('should push git sync', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse({ data: { isSuccessful: true } }));

			const ctx = createMockExecuteFunctions({
				service: 'appsmith',
				operation: 'git_sync',
				applicationId: 'app-123',
				appsmithBranch: 'develop',
				credentials: appsmithCredentials,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(fetchMock).toHaveBeenCalledWith(
				'https://appsmith.test.local/api/v1/git/push/app-123',
				expect.objectContaining({
					method: 'POST',
					body: JSON.stringify({ branchName: 'develop' }),
				}),
			);
		});

		it('should handle Appsmith API error', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse(
				{ responseMeta: { status: 401, success: false }, errorDisplay: 'Unauthorized' },
				false,
			));

			const ctx = createMockExecuteFunctions({
				service: 'appsmith',
				operation: 'list_pages',
				applicationId: 'app-bad',
				credentials: appsmithCredentials,
				continueOnFail: true,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.error).toBeDefined();
		});

		it('should throw for unknown Appsmith operation', async () => {
			const ctx = createMockExecuteFunctions({
				service: 'appsmith',
				operation: 'nonexistent_op',
				credentials: appsmithCredentials,
			});

			const node = new AishaAdminBridge();
			await expect(node.execute.call(ctx)).rejects.toThrow('Unknown Appsmith operation');
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Forgejo Operations
	// ═══════════════════════════════════════════════════════════════════════

	describe('Forgejo operations', () => {
		const forgejoCredentials = {
			aishaForgejoApi: {
				baseUrl: 'https://git.test.local',
				apiToken: 'test-forgejo-token',
			},
		};

		it('should have correct Forgejo operations', () => {
			const node = new AishaAdminBridge();
			const opProps = node.description.properties.filter((p) => p.name === 'operation');
			const forgejoOp = opProps.find((p) =>
				(p.displayOptions as { show?: Record<string, string[]> })?.show?.service?.includes('forgejo'),
			);
			const options = (forgejoOp as { options?: Array<{ value: string }> })?.options ?? [];
			const values = options.map((o) => o.value);
			expect(values).toEqual(['list_repos', 'create_branch', 'commit_file', 'create_pr', 'get_diff', 'merge_pr']);
		});

		it('should list repositories', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse({
				data: [{ id: 1, full_name: 'evymo/aisha-dirigent' }],
			}));

			const ctx = createMockExecuteFunctions({
				service: 'forgejo',
				operation: 'list_repos',
				repoSearchQuery: 'aisha',
				credentials: forgejoCredentials,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(result[0][0].json.operation).toBe('list_repos');
			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining('/repos/search?q=aisha'),
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: 'token test-forgejo-token',
					}),
				}),
			);
		});

		it('should create a branch', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse({ name: 'aisha/fix-i18n' }));

			const ctx = createMockExecuteFunctions({
				service: 'forgejo',
				operation: 'create_branch',
				repoOwner: 'aisha',
				repoName: 'dirigent',
				branchName: 'aisha/fix-i18n',
				baseBranch: 'main',
				credentials: forgejoCredentials,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(fetchMock).toHaveBeenCalledWith(
				'https://git.test.local/api/v1/repos/aisha/dirigent/branches',
				expect.objectContaining({
					method: 'POST',
					body: JSON.stringify({
						new_branch_name: 'aisha/fix-i18n',
						old_branch_name: 'main',
					}),
				}),
			);
		});

		it('should commit a new file', async () => {
			// First fetch: file lookup (404 = new file)
			fetchMock
				.mockRejectedValueOnce(new Error('not found'))
				.mockResolvedValueOnce(mockFetchResponse({ content: { sha: 'abc123' } }));

			const ctx = createMockExecuteFunctions({
				service: 'forgejo',
				operation: 'commit_file',
				repoOwner: 'aisha',
				repoName: 'dirigent',
				branchName: 'aisha/fix-i18n',
				filePath: 'src/i18n/segments/cs/core.json',
				fileContent: '{"key": "value"}',
				commitMessage: 'fix: add key',
				credentials: forgejoCredentials,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			// Second call should be POST (new file)
			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining('/contents/src/i18n/segments/cs/core.json'),
				expect.objectContaining({ method: 'POST' }),
			);
		});

		it('should create a pull request', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse({ number: 42, title: '[Aisha] Fix' }));

			const ctx = createMockExecuteFunctions({
				service: 'forgejo',
				operation: 'create_pr',
				repoOwner: 'aisha',
				repoName: 'dirigent',
				prTitle: '[Aisha] Fix missing translation',
				prBody: 'Automated fix',
				headBranch: 'aisha/fix-i18n',
				baseBranch: 'main',
				credentials: forgejoCredentials,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(fetchMock).toHaveBeenCalledWith(
				'https://git.test.local/api/v1/repos/aisha/dirigent/pulls',
				expect.objectContaining({
					method: 'POST',
					body: expect.stringContaining('[Aisha] Fix missing translation'),
				}),
			);
		});

		it('should get PR diff', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse([{ filename: 'src/hooks/useTest.ts' }]));

			const ctx = createMockExecuteFunctions({
				service: 'forgejo',
				operation: 'get_diff',
				repoOwner: 'aisha',
				repoName: 'dirigent',
				prNumber: 42,
				credentials: forgejoCredentials,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(fetchMock).toHaveBeenCalledWith(
				'https://git.test.local/api/v1/repos/aisha/dirigent/pulls/42/files',
				expect.anything(),
			);
		});

		it('should merge a PR', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse({ merged: true }));

			const ctx = createMockExecuteFunctions({
				service: 'forgejo',
				operation: 'merge_pr',
				repoOwner: 'aisha',
				repoName: 'dirigent',
				prNumber: 42,
				mergeMethod: 'squash',
				credentials: forgejoCredentials,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.success).toBe(true);
			expect(fetchMock).toHaveBeenCalledWith(
				'https://git.test.local/api/v1/repos/aisha/dirigent/pulls/42/merge',
				expect.objectContaining({
					method: 'POST',
					body: JSON.stringify({ Do: 'squash' }),
				}),
			);
		});

		it('should handle Forgejo API error', async () => {
			fetchMock.mockResolvedValue(mockFetchResponse({ message: 'Not Found' }, false));

			const ctx = createMockExecuteFunctions({
				service: 'forgejo',
				operation: 'list_repos',
				repoSearchQuery: 'nonexistent',
				credentials: forgejoCredentials,
				continueOnFail: true,
			});

			const node = new AishaAdminBridge();
			const result = await node.execute.call(ctx);

			expect(result[0][0].json.error).toBeDefined();
		});

		it('should throw for unknown Forgejo operation', async () => {
			const ctx = createMockExecuteFunctions({
				service: 'forgejo',
				operation: 'bad_op',
				credentials: forgejoCredentials,
			});

			const node = new AishaAdminBridge();
			await expect(node.execute.call(ctx)).rejects.toThrow('Unknown Forgejo operation');
		});
	});
});
