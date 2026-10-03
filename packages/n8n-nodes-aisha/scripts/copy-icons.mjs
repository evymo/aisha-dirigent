#!/usr/bin/env node
/**
 * copy-icons.mjs
 *
 * Copies SVG icons from source node dirs into dist/ so n8n can load them.
 * Run automatically after `tsc` via: npm run build
 *
 * Expected structure:
 *   nodes/<NodeName>/aisha.svg  →  dist/nodes/<NodeName>/aisha.svg
 */

import { readdirSync, copyFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const NODES_SRC = join(ROOT, 'nodes');
const NODES_DIST = join(ROOT, 'dist', 'nodes');

let copied = 0;

for (const nodeDir of readdirSync(NODES_SRC, { withFileTypes: true })) {
	if (!nodeDir.isDirectory()) continue;

	const srcDir = join(NODES_SRC, nodeDir.name);
	const distDir = join(NODES_DIST, nodeDir.name);

	for (const file of readdirSync(srcDir)) {
		if (!file.endsWith('.svg') && !file.endsWith('.png')) continue;

		if (!existsSync(distDir)) {
			mkdirSync(distDir, { recursive: true });
		}

		copyFileSync(join(srcDir, file), join(distDir, file));
		copied++;
	}
}

console.log(`✓ Copied ${copied} icon(s) to dist/`);
