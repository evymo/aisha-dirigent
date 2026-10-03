import path from 'node:path';
import { beforeAll, describe, it, expect } from 'vitest';
import { AishaRpc } from '../nodes/AishaRpc/AishaRpc.node';
import { AishaAudit } from '../nodes/AishaAudit/AishaAudit.node';
import { AishaStoryManager } from '../nodes/AishaStoryManager/AishaStoryManager.node';
import { AishaModelRouter } from '../nodes/AishaModelRouter/AishaModelRouter.node';
import { AishaTrigger } from '../nodes/AishaTrigger/AishaTrigger.node';
import { AishaNodeFactory } from '../nodes/AishaNodeFactory/AishaNodeFactory.node';

/**
 * RPC Contract Test
 *
 * Validates that all RPC function names used in community nodes
 * match the known Supabase database functions.
 *
 * This prevents runtime failures from function name mismatches.
 * Update KNOWN_DB_FUNCTIONS when new migrations add RPC functions.
 */

type RpcInventoryEntry = {
	file: string;
	name: string;
	params: string[];
};

const ROOT = path.resolve(__dirname, '../../..');
const RPC_INVENTORY = new Map<string, RpcInventoryEntry>();

function expectKnownRpc(name: string): void {
	expect(
		RPC_INVENTORY.has(name),
		`RPC "${name}" is not present in the shared SQL inventory`,
	).toBe(true);
}

function expectRpcParams(name: string, params: string[]): void {
	const entry = RPC_INVENTORY.get(name);
	expect(entry, `RPC "${name}" is missing from the shared SQL inventory`).toBeDefined();
	for (const param of params) {
		expect(
			entry?.params.includes(param),
			`RPC "${name}" is missing expected parameter "${param}" in ${entry?.file}`,
		).toBe(true);
	}
}

describe('RPC Contract', () => {
	beforeAll(async () => {
		const inventoryModulePath = path.join(ROOT, 'scripts/db/lib/rpc-inventory.mjs');
		const { buildRpcInventory } = await import(inventoryModulePath);
		const inventory = buildRpcInventory(ROOT) as RpcInventoryEntry[];
		for (const entry of inventory) {
			RPC_INVENTORY.set(entry.name, entry);
		}
	});

	it('AishaRpc — all function options should be known DB functions', () => {
		const node = new AishaRpc();
		const funcProps = node.description.properties.filter((p) => p.name === 'functionName');

		for (const prop of funcProps) {
			if (prop.type === 'options' && 'options' in prop) {
				const options = prop.options as Array<{ value: string }>;
				for (const opt of options) {
					expectKnownRpc(opt.value);
				}
			}
		}
	});

	it('AishaAudit — should call write_audit_journal (not insert_audit_entry)', () => {
		const node = new AishaAudit();
		expect(node.description.name).toBe('aishaAudit');
		expectKnownRpc('write_audit_journal');
		expectRpcParams('write_audit_journal', ['p_action_type', 'p_area', 'p_details']);
	});

	it('AishaStoryManager — all operations should map to known RPC functions', () => {
		const node = new AishaStoryManager();
		const expectedMapping: Record<string, string> = {
			getContext: 'mcp_get_story_context',
			transitionStatus: 'transition_story_delivery_status',
			getAllowedTransitions: 'get_allowed_transitions',
			getTimeline: 'get_delivery_timeline',
			manageEnvironment: 'upsert_story_environment',
			getEnvironments: 'get_story_environments',
			createRuleset: 'create_story_ruleset',
			estimateEffort: 'estimate_effort',
		};

		const opProp = node.description.properties.find((p) => p.name === 'operation');
		const options = (opProp as { options?: Array<{ value: string }> })?.options ?? [];

		for (const opt of options) {
			expect(
				expectedMapping[opt.value],
				`AishaStoryManager operation "${opt.value}" has no mapping — add to contract`,
			).toBeDefined();
			expectKnownRpc(expectedMapping[opt.value]);
		}
	});

	it('shared inventory includes expected params for core story RPCs', () => {
		expectRpcParams('mcp_get_story_context', ['p_story_id']);
		expectRpcParams('transition_story_delivery_status', [
			'p_metadata',
			'p_new_status',
			'p_story_id',
			'p_trigger_source',
		]);
		expectRpcParams('estimate_effort', ['p_affected_files', 'p_complexity_factors', 'p_session_id', 'p_task_description']);
	});

	it('AishaNodeFactory — should have all 6 operations', () => {
		const node = new AishaNodeFactory();
		const opProp = node.description.properties.find((p) => p.name === 'operation');
		const options = (opProp as { options?: Array<{ value: string }> })?.options ?? [];
		const values = options.map((o) => o.value);
		expect(values).toEqual(['generate', 'validate', 'test', 'deploy', 'register', 'listNodes']);
		expectRpcParams('register_custom_node', [
			'p_category',
			'p_description',
			'p_display_name',
			'p_n8n_node_type',
			'p_node_name',
			'p_package_json',
			'p_source_request_id',
			'p_version',
		]);
	});

	it('AishaTrigger — all event types should be defined', () => {
		const node = new AishaTrigger();
		const eventProp = node.description.properties.find((p) => p.name === 'eventType');
		expect(eventProp).toBeDefined();
	});

	it('AishaModelRouter — should have 5 outputs', () => {
		const node = new AishaModelRouter();
		expect(node.description.outputs).toHaveLength(5);
	});

	it('all nodes should have aishaPostgrestApi credential', () => {
		const nodes = [
			new AishaRpc(),
			new AishaAudit(),
			new AishaStoryManager(),
			new AishaModelRouter(),
			new AishaNodeFactory(),
		];

		for (const node of nodes) {
			const creds = node.description.credentials ?? [];
			const hasSupabase = creds.some((c) => c.name === 'aishaPostgrestApi');
			expect(hasSupabase, `${node.description.name} should require aishaPostgrestApi credential`).toBe(true);
		}
	});
});
