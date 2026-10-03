import { defineConfig } from 'vitest/config';

export default defineConfig({
	// n8n-workflow 1.120 ships a proper `exports` map (dist/cjs + dist/esm) and
	// hoists to the workspace root, so the old package-local dist/index.js alias
	// no longer resolves. Let vitest resolve it via normal node resolution.
	test: {
		globals: true,
		environment: 'node',
		include: ['__tests__/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'lcov', 'json-summary'],
			include: ['nodes/**/*.ts', 'credentials/**/*.ts'],
			exclude: ['**/*.test.ts', '__tests__/**'],
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 80,
				statements: 80,
			},
		},
		testTimeout: 10000,
	},
});
