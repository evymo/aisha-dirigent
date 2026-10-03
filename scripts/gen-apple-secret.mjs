#!/usr/bin/env node
/**
 * gen-apple-secret.mjs
 *
 * Generates an Apple Sign-In client_secret JWT from a .p8 private key.
 * The secret is valid for up to 180 days and must be renewed before expiry.
 *
 * Usage:
 *   node scripts/gen-apple-secret.mjs \
 *     --key AuthKey_XXXXXXXXXX.p8 \
 *     --team-id XXXXXXXXXX \
 *     --client-id com.example.app.web \
 *     --key-id XXXXXXXXXX \
 *     [--days 180]
 *
 * Output: prints the JWT to stdout
 */

import { readFileSync } from "fs";
import { createPrivateKey, createSign } from "crypto";

function base64url(buf) {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function encodeJwt(header, payload, key) {
  const headerB64 = base64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)));
  const data = `${headerB64}.${payloadB64}`;

  const sign = createSign("SHA256");
  sign.update(data);
  sign.end();
  const sig = sign.sign({ key, dsaEncoding: "ieee-p1363" });
  return `${data}.${base64url(sig)}`;
}

// ── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
};

const keyFile  = get("--key");
const teamId   = get("--team-id");
const clientId = get("--client-id");
const keyId    = get("--key-id");
const days     = parseInt(get("--days") ?? "180", 10);

if (!keyFile || !teamId || !clientId || !keyId) {
  console.error(
    "Usage: node scripts/gen-apple-secret.mjs" +
    " --key <file.p8>" +
    " --team-id <TEAM_ID>" +
    " --client-id <SERVICES_ID>" +
    " --key-id <KEY_ID>" +
    " [--days 180]"
  );
  process.exit(1);
}

// ── Build JWT ────────────────────────────────────────────────────────────────
const now = Math.floor(Date.now() / 1000);
const exp = now + days * 86400;

const pem = readFileSync(keyFile, "utf8");
const privateKey = createPrivateKey(pem);

const header  = { alg: "ES256", kid: keyId };
const payload = {
  iss: teamId,
  iat: now,
  exp,
  aud: "https://appleid.apple.com",
  sub: clientId,
};

const token = encodeJwt(header, payload, privateKey);

console.log(token);
console.error(`\nExpires: ${new Date(exp * 1000).toISOString()} (${days} days)`);
