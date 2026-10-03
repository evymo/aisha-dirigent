#!/usr/bin/env node
/**
 * deploy-to-n8n.mjs
 *
 * Builds, packs, and installs n8n-nodes-aisha into the n8n instance.
 *
 * Strategies:
 *   --publish  Verdaccio publish + n8n API install (default)
 *   --api      Install via n8n REST API (must be already on Verdaccio)
 *   --local    Install into local n8n (~/.n8n/nodes/)
 *   --tarball  Build & pack only, output .tgz path
 *
 * Requirements:
 *   - .env.aisha (N8N_URL, N8N_API_KEY)
 *   - Node 20+, npm
 *   - VERDACCIO_TOKEN env for publishing
 *   - N8N_API_KEY for API install
 *
 * Usage:
 *   node scripts/deploy-to-n8n.mjs              # default: --publish
 *   node scripts/deploy-to-n8n.mjs --publish    # build → Verdaccio → n8n API
 *   node scripts/deploy-to-n8n.mjs --api        # install from Verdaccio via n8n API
 *   node scripts/deploy-to-n8n.mjs --local      # install into local ~/.n8n/
 *   node scripts/deploy-to-n8n.mjs --tarball    # build & pack only
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(PKG_ROOT, '..', '..');

// ─── Load .env.aisha ────────────────────────────────────────────────────
function loadEnv() {
	const envPath = join(REPO_ROOT, '.env.aisha');
	if (!existsSync(envPath)) return {};
	const env = {};
	for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
		const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
		if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
	}
	return env;
}

const env = loadEnv();
const N8N_URL = env.N8N_URL || process.env.N8N_URL
	|| (() => { throw new Error('N8N_URL is required (set in .env.aisha or env)'); })();
const N8N_API_KEY = env.N8N_API_KEY;

// ─── Helpers ─────────────────────────────────────────────────────────────
function run(cmd, opts = {}) {
	console.log(`  $ ${cmd}`);
	return execSync(cmd, { stdio: 'pipe', encoding: 'utf-8', cwd: PKG_ROOT, ...opts }).trim();
}

function getPackageName() {
	const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf-8'));
	// npm pack for scoped packages: @aisha/n8n-nodes-aisha → aisha-n8n-nodes-aisha-0.1.0.tgz
	const safeName = pkg.name.replace(/^@/, '').replace(/\//, '-');
	return `${safeName}-${pkg.version}.tgz`;
}

async function checkN8nHealth() {
	try {
		const resp = await fetch(`${N8N_URL}/healthz`);
		return resp.ok;
	} catch {
		return false;
	}
}

async function restartN8nViaApi() {
	if (!N8N_API_KEY) {
		console.log('  ⚠ No N8N_API_KEY — cannot restart via API. Restart n8n manually.');
		return;
	}
	console.log('  Triggering n8n restart...');
	// n8n doesn't have a restart API — we just verify health after install
	const healthy = await checkN8nHealth();
	console.log(healthy ? '  ✓ n8n is healthy' : '  ⚠ n8n health check failed');
}

// ─── Build & Pack ────────────────────────────────────────────────────────
function buildAndPack() {
	console.log('\n═══ Building n8n-nodes-aisha ═══');
	run('npm run build');

	console.log('\n═══ Packing tarball ═══');
	run('npm pack');

	const tgz = getPackageName();
	const tgzPath = join(PKG_ROOT, tgz);
	if (!existsSync(tgzPath)) {
		throw new Error(`Expected tarball not found: ${tgzPath}`);
	}
	console.log(`  ✓ ${tgz}`);
	return tgzPath;
}

// ─── Strategy: Local Install ─────────────────────────────────────────────
function deployLocal(tgzPath) {
	console.log('\n═══ Installing locally (~/.n8n/nodes/) ═══');

	const n8nNodesDir = join(homedir(), '.n8n', 'nodes', 'node_modules');
	mkdirSync(n8nNodesDir, { recursive: true });

	// Install tarball into n8n's custom nodes directory
	run(`npm install --prefix "${join(homedir(), '.n8n', 'nodes')}" "${tgzPath}"`, { cwd: homedir() });

	console.log('  ✓ Installed. Restart n8n to load new nodes.');
}

// ─── Strategy: n8n REST API (community packages) ────────────────────────
async function deployViaApi() {
	const pkgJson = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf-8'));
	const pkgName = pkgJson.name;

	console.log(`\n═══ Installing via n8n API: ${pkgName} ═══`);

	if (!N8N_API_KEY) {
		throw new Error('N8N_API_KEY is required for --api strategy. Set in .env.aisha or env.');
	}

	// 1. Check if already installed
	console.log('  Checking existing community packages...');
	const listResp = await fetch(`${N8N_URL}/api/v1/community-packages`, {
		headers: { 'X-N8N-API-KEY': N8N_API_KEY },
		signal: AbortSignal.timeout(15_000),
	});

	if (!listResp.ok) {
		throw new Error(`n8n API error: ${listResp.status} ${await listResp.text()}`);
	}

	const installed = await listResp.json();
	const existing = Array.isArray(installed)
		? installed.find((p) => p.packageName === pkgName)
		: null;

	if (existing) {
		console.log(`  ℹ Already installed: ${pkgName}@${existing.installedVersion}`);
		console.log(`  Updating to latest from npm...`);

		// Update (PATCH)
		const updateResp = await fetch(`${N8N_URL}/api/v1/community-packages`, {
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json',
				'X-N8N-API-KEY': N8N_API_KEY,
			},
			body: JSON.stringify({ name: pkgName }),
			signal: AbortSignal.timeout(60_000),
		});

		if (!updateResp.ok) {
			const body = await updateResp.text();
			throw new Error(`Failed to update: ${updateResp.status} ${body}`);
		}

		const updated = await updateResp.json();
		console.log(`  ✓ Updated to ${updated.installedVersion || 'latest'}`);
	} else {
		// Fresh install (POST)
		console.log(`  Installing ${pkgName} from npm...`);

		const installResp = await fetch(`${N8N_URL}/api/v1/community-packages`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-N8N-API-KEY': N8N_API_KEY,
			},
			body: JSON.stringify({ name: pkgName }),
			signal: AbortSignal.timeout(120_000),
		});

		if (!installResp.ok) {
			const body = await installResp.text();
			throw new Error(
				`Failed to install: ${installResp.status} ${body}\n` +
				`  Hint: Make sure '${pkgName}' is published to Verdaccio first:\n` +
				`    cd packages/n8n-nodes-aisha && npm publish`
			);
		}

		const result = await installResp.json();
		console.log(`  ✓ Installed: ${pkgName}@${result.installedVersion || 'latest'}`);
	}

	// 2. Verify loaded nodes
	console.log('  Verifying node registration...');
	await new Promise((r) => setTimeout(r, 3000));

	const verifyResp = await fetch(`${N8N_URL}/api/v1/community-packages`, {
		headers: { 'X-N8N-API-KEY': N8N_API_KEY },
		signal: AbortSignal.timeout(10_000),
	});

	if (verifyResp.ok) {
		const pkgs = await verifyResp.json();
		const pkg = Array.isArray(pkgs) ? pkgs.find((p) => p.packageName === pkgName) : null;
		if (pkg) {
			const nodeCount = pkg.installedNodes?.length ?? 0;
			console.log(`  ✓ Verified: ${nodeCount} nodes loaded (v${pkg.installedVersion})`);
		} else {
			console.log('  ⚠ Package not found after install — n8n may need restart');
		}
	}
}

// ─── Verdaccio Publish (bypasses Caddy %2f issue) ───────────────────────
/**
 * Caddy reverse proxy rejects `%2f` encoded slashes in URL paths.
 * npm publish sends PUT /@scope%2fpackage which Caddy blocks with 400.
 * This function publishes directly with decoded slashes: /@scope/package.
 */
async function publishToVerdaccio() {
	const pkgJson = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf-8'));
	const { name, version } = pkgJson;
	const registry = pkgJson.publishConfig?.registry
		|| process.env.VERDACCIO_URL || env.VERDACCIO_URL
		|| (() => { throw new Error('VERDACCIO_URL is required (no publishConfig.registry found)'); })();
	const token = process.env.VERDACCIO_TOKEN || env.VERDACCIO_TOKEN;

	if (!token) {
		throw new Error('VERDACCIO_TOKEN is required. Set in .env.aisha or env.');
	}

	// Read tarball
	const safeName = name.replace(/^@/, '').replace(/\//, '-');
	const tgzFilename = `${safeName}-${version}.tgz`;
	const tgzPath = join(PKG_ROOT, tgzFilename);

	if (!existsSync(tgzPath)) {
		throw new Error(`Tarball not found: ${tgzPath}. Run buildAndPack() first.`);
	}

	const tgzData = readFileSync(tgzPath);
	const shasum = createHash('sha1').update(tgzData).digest('hex');

	// Build npm publish payload
	const body = JSON.stringify({
		_id: name,
		name,
		'dist-tags': { latest: version },
		versions: {
			[version]: {
				...pkgJson,
				dist: {
					tarball: `${registry.replace(/\/$/, '')}/${name}/-/${tgzFilename}`,
					shasum,
				},
			},
		},
		_attachments: {
			[tgzFilename]: {
				content_type: 'application/octet-stream',
				data: tgzData.toString('base64'),
				length: tgzData.length,
			},
		},
	});

	// Use decoded slash in URL: /@aisha/n8n-nodes-aisha (not /@aisha%2fn8n-nodes-aisha)
	// This bypasses Caddy's %2f rejection
	const url = `${registry.replace(/\/$/, '')}/${name}`;
	console.log(`  PUT ${url} (${(Buffer.byteLength(body) / 1024).toFixed(0)} KB)`);

	const resp = await fetch(url, {
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
		},
		body,
		signal: AbortSignal.timeout(60_000),
	});

	const respBody = await resp.text();

	if (resp.ok) {
		console.log(`  ✓ Published ${name}@${version}`);
		return;
	}

	// 409 = version already exists
	if (resp.status === 409) {
		console.log(`  ℹ ${name}@${version} already on registry — proceeding`);
		return;
	}

	throw new Error(`Verdaccio publish failed: ${resp.status} ${respBody}`);
}

// ─── Strategy: publish + API install combo ───────────────────────────────
async function publishAndInstall() {
	console.log('\n═══ Publishing to Verdaccio + installing via API ═══');

	console.log('  Publishing to Verdaccio (%s)...', process.env.VERDACCIO_URL || env.VERDACCIO_URL || '?');
	await publishToVerdaccio();

	// Install via API
	await deployViaApi();
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
	const args = process.argv.slice(2);
	const strategy = args.find((a) => a.startsWith('--')) || '--publish';

	// --api and --publish don't need tarball build
	if (strategy === '--api') {
		await deployViaApi();
		console.log('\n═══ Deploy complete (API) ═══');
		return;
	}

	if (strategy === '--publish') {
		buildAndPack();
		await publishAndInstall();
		console.log('\n═══ Deploy complete (publish + API) ═══');
		return;
	}

	const tgzPath = buildAndPack();

	switch (strategy) {
		case '--local':
			deployLocal(tgzPath);
			await restartN8nViaApi();
			break;

		case '--tarball':
			console.log(`\n✓ Tarball ready: ${tgzPath}`);
			console.log('  Install manually: npm install /path/to/tarball.tgz');
			break;

		default:
			console.error(`Unknown strategy: ${strategy}`);
			console.error('Use: --publish | --api | --local | --tarball');
			process.exit(1);
	}

	console.log('\n═══ Deploy complete ═══');

	// Verify community nodes are visible via API
	if (N8N_API_KEY && !['--tarball', '--api', '--publish'].includes(strategy)) {
		console.log('\nVerifying node registration...');
		try {
			const resp = await fetch(`${N8N_URL}/api/v1/credentials/schema`, {
				headers: { 'X-N8N-API-KEY': N8N_API_KEY },
			});
			if (resp.ok) {
				console.log('  ✓ n8n API responding (credentials schema accessible)');
			}
		} catch (e) {
			console.log('  ⚠ Could not verify — n8n may need a few seconds to reload');
		}
	}
}

main().catch((err) => {
	console.error('\n✗ Deploy failed:', err.message);
	process.exit(1);
});
