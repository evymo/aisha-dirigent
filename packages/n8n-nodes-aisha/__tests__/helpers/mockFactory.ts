import { vi } from 'vitest';
import type {
	IExecuteFunctions,
	INodeExecutionData,
	ICredentialDataDecryptedObject,
	INode,
	IWorkflowDataProxyData,
	IPollFunctions,
	ISupplyDataFunctions,
} from 'n8n-workflow';

/**
 * Mock factory for creating IExecuteFunctions and IPollFunctions contexts
 * used in n8n node unit tests.
 *
 * @example
 * ```ts
 * const ctx = createMockExecuteFunctions({
 *   operation: 'getContext',
 *   storyId: 'abc-123',
 * });
 * const node = new AishaStoryManager();
 * const result = await node.execute.call(ctx);
 * ```
 */

const DEFAULT_CREDENTIALS: ICredentialDataDecryptedObject = {
	// Mirror the real AishaPostgrestApi credential shape (property `postgrestUrl`).
	// The nodes read it via requirePostgrestUrl(); the legacy `supabaseUrl` key was
	// retired with the Supabase→PostgREST rename, so mocking it here silently broke.
	postgrestUrl: 'https://postgrest.test.local',
	serviceRoleKey: 'test-service-role-key',
	anonKey: 'test-anon-key',
};

const DEFAULT_MCP_CREDENTIALS: ICredentialDataDecryptedObject = {
	mcpServerUrl: 'https://mcp.test.local',
	accessToken: 'test-access-token',
	scope: 'session',
};

interface MockOptions {
	/** Node parameters (operation, fields, etc.) */
	[key: string]: unknown;
	/** Override credentials */
	credentials?: Record<string, ICredentialDataDecryptedObject>;
	/** Override input data */
	inputData?: INodeExecutionData[];
	/** Enable continueOnFail */
	continueOnFail?: boolean;
	/** Workflow ID */
	workflowId?: string;
	/** Workflow name */
	workflowName?: string;
}

export function createMockExecuteFunctions(options: MockOptions = {}): IExecuteFunctions {
	const {
		credentials = {},
		inputData = [{ json: {} }],
		continueOnFail = false,
		workflowId = 'test-workflow-id',
		workflowName = 'Test Workflow',
		...params
	} = options;

	const credentialMap: Record<string, ICredentialDataDecryptedObject> = {
		aishaPostgrestApi: DEFAULT_CREDENTIALS,
		aishaMcpApi: DEFAULT_MCP_CREDENTIALS,
		...credentials,
	};

	const mockNode: Partial<INode> = {
		name: 'Test Node',
		type: 'n8n-nodes-aisha.aishaRpc',
		typeVersion: 1,
		position: [0, 0],
		parameters: {},
	};

	return {
		getInputData: vi.fn().mockReturnValue(inputData),
		getNodeParameter: vi.fn((paramName: string, itemIndex: number, fallbackValue?: unknown) => {
			if (paramName in params) return params[paramName];
			return fallbackValue;
		}),
		getCredentials: vi.fn(async (name: string) => {
			const creds = credentialMap[name];
			if (!creds) throw new Error(`Credentials "${name}" not found`);
			return creds;
		}),
		getNode: vi.fn().mockReturnValue(mockNode),
		getWorkflow: vi.fn().mockReturnValue({ id: workflowId, name: workflowName }),
		continueOnFail: vi.fn().mockReturnValue(continueOnFail),
		helpers: {
			httpRequest: vi.fn(),
			returnJsonArray: vi.fn((data: unknown[]) =>
				data.map((d) => ({
					json: d as Record<string, unknown>,
				})),
			),
		},
		// Additional context stubs
		getWorkflowStaticData: vi.fn().mockReturnValue({}),
		getRestApiUrl: vi.fn().mockReturnValue('http://localhost:5678'),
		getTimezone: vi.fn().mockReturnValue('Europe/Prague'),
		getMode: vi.fn().mockReturnValue('manual'),
		evaluateExpression: vi.fn((expr: string) => expr),
	} as unknown as IExecuteFunctions;
}

export function createMockPollFunctions(options: MockOptions = {}): IPollFunctions {
	const {
		credentials = {},
		continueOnFail = false,
		workflowId = 'test-workflow-id',
		workflowName = 'Test Workflow',
		...params
	} = options;

	const credentialMap: Record<string, ICredentialDataDecryptedObject> = {
		aishaPostgrestApi: DEFAULT_CREDENTIALS,
		aishaMcpApi: DEFAULT_MCP_CREDENTIALS,
		...credentials,
	};

	const staticData: Record<string, unknown> = {};

	return {
		getNodeParameter: vi.fn((paramName: string, fallbackValue?: unknown) => {
			if (paramName in params) return params[paramName];
			return fallbackValue;
		}),
		getCredentials: vi.fn(async (name: string) => {
			const creds = credentialMap[name];
			if (!creds) throw new Error(`Credentials "${name}" not found`);
			return creds;
		}),
		getNode: vi.fn().mockReturnValue({ name: 'Test Trigger' }),
		getWorkflow: vi.fn().mockReturnValue({ id: workflowId, name: workflowName }),
		getWorkflowStaticData: vi.fn().mockReturnValue(staticData),
		getMode: vi.fn().mockReturnValue('manual'),
		helpers: {
			httpRequest: vi.fn(),
		},
	} as unknown as IPollFunctions;
}

/**
 * Helper to create a mock fetch response.
 */
export function mockFetchResponse(data: unknown, ok = true): Response {
	return {
		ok,
		status: ok ? 200 : 400,
		json: async () => data,
		text: async () => JSON.stringify(data),
		headers: new Headers(),
	} as unknown as Response;
}

/**
 * Setup global fetch mock for all tests.
 * Call in beforeEach.
 */
export function setupFetchMock(
	defaultResponse: unknown = { success: true },
): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(defaultResponse));
	global.fetch = fetchMock as unknown as typeof fetch;
	return fetchMock;
}

/**
 * Create mock ISupplyDataFunctions for ai_languageModel nodes (e.g. AishaLlmRouter).
 */
export function createMockSupplyDataFunctions(options: MockOptions = {}): ISupplyDataFunctions {
	const {
		credentials = {},
		continueOnFail = false,
		workflowId = 'test-workflow-id',
		workflowName = 'Test Workflow',
		...params
	} = options;

	const credentialMap: Record<string, ICredentialDataDecryptedObject> = {
		aishaPostgrestApi: DEFAULT_CREDENTIALS,
		...credentials,
	};

	const mockNode: Partial<INode> = {
		name: 'Test LLM Node',
		type: 'n8n-nodes-aisha.aishaLlmRouter',
		typeVersion: 1,
		position: [0, 0],
		parameters: {},
	};

	return {
		getNodeParameter: vi.fn((paramName: string, _itemIndex: number, fallbackValue?: unknown) => {
			if (paramName in params) return params[paramName];
			return fallbackValue;
		}),
		getCredentials: vi.fn(async (name: string) => {
			const creds = credentialMap[name];
			if (!creds) throw new Error(`Credentials "${name}" not found`);
			return creds;
		}),
		getNode: vi.fn().mockReturnValue(mockNode),
		getWorkflow: vi.fn().mockReturnValue({ id: workflowId, name: workflowName }),
		sendMessageToUI: vi.fn(),
		helpers: {
			httpRequest: vi.fn(),
		},
	} as unknown as ISupplyDataFunctions;
}
