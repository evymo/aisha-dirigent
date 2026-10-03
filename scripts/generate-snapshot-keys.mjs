#!/usr/bin/env node
/**
 * Ops: vygeneruje Ed25519 pár pro podepisování snímků (PR-9).
 * NIC nezapisuje na disk — vytiskne JWK + instrukce kam který klíč patří.
 *   node scripts/generate-snapshot-keys.mjs [key_id]
 */
import { generateKeyPairSync, randomUUID } from 'node:crypto';

const keyId = process.argv[2] ?? `snap-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });

console.log(`key_id: ${keyId}\n`);
console.log('PUBLIC JWK  → instance overlay app.config.json → "snapshot_public_jwk"');
console.log('             (smí být v repu — je veřejný):');
console.log(JSON.stringify(pub, null, 2));
console.log('\nPRIVATE JWK → POUZE env emitující služby (story-loop/reporting job),');
console.log('             NIKDY do repa, klienta ani logu. Rotace = nový key_id:');
console.log(JSON.stringify(priv, null, 2));
