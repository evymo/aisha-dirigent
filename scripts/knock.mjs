#!/usr/bin/env node
/**
 * knock.mjs — zaťukat na dveře. Jeden datagram, žádná odpověď.
 *
 * REFERENČNÍ IMPLEMENTACE. Skládá rámec TÝMŽ balíčkem, jaký použije mobilní
 * klient (`@aisha/knock-protocol`) — tady jen s Node adaptérem místo RN.
 * Kdyby si odesílač formát psal sám, měli bychom dvě pravdy o tom, co je
 * platné zaťukání, a rozešly by se při první změně.
 *
 * ⭐ NEČEKÁ NA ODPOVĚĎ, protože žádná nepřijde. Dveře zásadně mlčí (K2/T3):
 * úspěch i odmítnutí vypadají zvenčí stejně — jako zavřený port. Klient proto
 * NESMÍ hlásit „otevřeno"; hlásí „zaťukáno" a ověří se tím, že projde další
 * požadavek. Kdo tuhle vlastnost obejde odpovědí, zahodí celou nenápadnost.
 *
 * Použití:
 *   node scripts/knock.mjs --host <fqdn> --port <port> [--scope ops]
 *        [--roster <soubor.json>] [--kid <kid>] [--bad]
 *
 *   --roster  JSON { kid: {hmacKeyHex, otpSeedHex, scopes[]} }; jinak SPA_OPERATORS_B64
 *   --bad     pošle rámec s ROZBITÝM podpisem — sonda, že dveře umí odmítnout
 *
 * Tajemství se NEVYPISUJÍ: skript tiskne jen kid, scope a délku datagramu.
 */
import { createSocket } from 'node:dgram';
import { readFileSync } from 'node:fs';
import { encodeFrame, totp, hexToBytes } from '../packages/knock-protocol/dist/index.js';
import { nodeCrypto } from '../packages/knock-protocol/dist/node.js';

const argv = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const flag = (n) => argv.includes(n);

const host = arg('--host');
if (!host) {
  process.stderr.write('knock: --host <fqdn> je povinný\n');
  process.exit(2);
}
// Port je RUČNÍ deklarace instance (SPA_KNOCK_PUBLIC_PORT) — výchozí hodnota by
// klepala na port jiné instance téhož serveru a nic by to neřeklo (dveře mlčí).
const portText = arg('--port') ?? process.env.SPA_KNOCK_PUBLIC_PORT ?? '';
const port = Number(portText);
if (!/^\d+$/.test(portText) || port < 1 || port > 65535) {
  process.stderr.write('knock: --port <port> je povinný (nebo SPA_KNOCK_PUBLIC_PORT) — port instance se nehádá\n');
  process.exit(2);
}
const scope = arg('--scope', 'ops');

// Roster ze souboru nebo z prostředí — tatáž dvojice zdrojů, jakou čte služba.
// Žádný default: bez pověření se nemá co poslat a hádat se nebude.
const rosterFile = arg('--roster');
const rosterRaw = rosterFile
  ? readFileSync(rosterFile, 'utf8')
  : process.env.SPA_OPERATORS_B64
    ? Buffer.from(process.env.SPA_OPERATORS_B64, 'base64').toString('utf8')
    : null;
if (!rosterRaw) {
  process.stderr.write('knock: chybí pověření — dodej --roster <soubor> nebo SPA_OPERATORS_B64\n');
  process.exit(2);
}
const roster = JSON.parse(rosterRaw);
const kid = arg('--kid') ?? Object.keys(roster)[0];
const op = roster[kid];
if (!op) {
  process.stderr.write(`knock: kid '${kid}' není v rosteru\n`);
  process.exit(2);
}

const nowSec = Math.floor(Date.now() / 1000);
const otp = totp(nodeCrypto, hexToBytes(op.otpSeedHex), nowSec);
const { frame, nonceHex } = encodeFrame(
  nodeCrypto,
  { kid, ts: nowSec, scope, otp },
  hexToBytes(op.hmacKeyHex),
);

// Sonda „umí to odmítnout": překlopí poslední bajt, tedy podpis. Rámec je jinak
// bezchybný, takže se měří VÝHRADNĚ ověření podpisu — ne délka ani formát.
const datagram = Uint8Array.from(frame);
if (flag('--bad')) datagram[datagram.length - 1] ^= 0xff;

const sock = createSocket('udp4');
sock.send(datagram, port, host, (err) => {
  sock.close();
  if (err) {
    process.stderr.write(`knock: odeslání selhalo: ${err.message}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `zaťukáno${flag('--bad') ? ' (ZÁMĚRNĚ ROZBITÝ PODPIS)' : ''}: ` +
      `kid=${kid} scope=${scope} bajtů=${datagram.length} nonce=${nonceHex.slice(0, 8)}… ` +
      `→ ${host}:${port}\n` +
      'odpověď se NEČEKÁ — dveře mlčí; ověř to průchodem dalšího požadavku.\n',
  );
});
