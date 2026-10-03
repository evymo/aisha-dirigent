import { describe, it, expect } from 'vitest';
import { AishaPostgrestApi } from '../credentials/AishaPostgrestApi.credentials';
import { AishaMcpApi } from '../credentials/AishaMcpApi.credentials';

describe('Credentials', () => {
	// Renamed from the legacy aishaSupabaseApi after the Supabase→PostgREST
	// migration (PR #82); the old credential file was removed but this test
	// still imported it, breaking n8n: Test & Build whenever the job ran.
	describe('AishaPostgrestApi', () => {
		it('should have correct credential name', () => {
			const cred = new AishaPostgrestApi();
			expect(cred.name).toBe('aishaPostgrestApi');
			expect(cred.displayName).toBeDefined();
		});

		it('should have required fields', () => {
			const cred = new AishaPostgrestApi();
			const fieldNames = cred.properties.map((p) => p.name);
			expect(fieldNames).toContain('postgrestUrl');
			expect(fieldNames).toContain('serviceRoleKey');
		});

		it('should mark serviceRoleKey as password type', () => {
			const cred = new AishaPostgrestApi();
			const secretField = cred.properties.find((p) => p.name === 'serviceRoleKey');
			expect(secretField?.typeOptions?.password).toBe(true);
		});
	});

	describe('AishaMcpApi', () => {
		it('should have correct credential name', () => {
			const cred = new AishaMcpApi();
			expect(cred.name).toBe('aishaMcpApi');
			expect(cred.displayName).toBeDefined();
		});

		it('should have required fields', () => {
			const cred = new AishaMcpApi();
			const fieldNames = cred.properties.map((p) => p.name);
			expect(fieldNames).toContain('mcpServerUrl');
			expect(fieldNames).toContain('accessToken');
			expect(fieldNames).toContain('scope');
		});

		it('should have scope options', () => {
			const cred = new AishaMcpApi();
			const scopeField = cred.properties.find((p) => p.name === 'scope');
			expect(scopeField?.type).toBe('options');
		});
	});
});
