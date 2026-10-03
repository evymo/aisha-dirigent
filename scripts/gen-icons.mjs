#!/usr/bin/env node
/**
 * AISHA brand icon generator.
 * Single source of truth: brand/aisha-icon.svg (transparent gradient robot mark).
 * Regenerates every app/launcher/favicon/notification asset across the repo.
 *
 * Usage:  npm run gen:icons
 * Dependency: sharp (devDependency).
 *
 * DO NOT hand-edit generated icons — edit brand/aisha-icon.svg and re-run.
 */
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DARK = '#0E0E10';
const MASTER = path.join(ROOT, 'brand/aisha-icon.svg');

const master = fs.readFileSync(MASTER, 'utf8');
const inner = master.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const whiteSVG = master.replace(/fill="rgb\([^)]*\)"/g, 'fill="#FFFFFF"').replace(/fill="url\(#Gradient[0-9]*\)"/g, 'fill="#FFFFFF"');
const logoSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><circle cx="500" cy="500" r="500" fill="${DARK}"/><svg x="118" y="118" width="764" height="764" viewBox="0 0 2000 2000" preserveAspectRatio="xMidYMid meet">${inner}</svg></svg>`;

const blank = (w, h, bg) => sharp({ create: { width: w, height: h, channels: 4, background: bg || { r: 0, g: 0, b: 0, alpha: 0 } } });
const trimmedOf = async (svg) => sharp(await sharp(Buffer.from(svg), { density: 600 }).png().toBuffer()).trim({ threshold: 10 }).toBuffer();

let ROBOT, WHITE;

async function place(robot, size, innerPx, bg) {
  const r = await sharp(robot).resize(innerPx, innerPx, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  const off = Math.round((size - innerPx) / 2);
  let img = blank(size, size, bg).composite([{ input: r, left: off, top: off }]);
  if (bg) img = img.flatten({ background: bg }).removeAlpha();
  return img.png().toBuffer();
}
async function render(spec) {
  if (spec.t === 'tile')     return place(ROBOT, spec.size, Math.round(spec.size * 0.64), { r: 14, g: 14, b: 16, alpha: 1 });
  if (spec.t === 'transp')   return place(ROBOT, spec.size, Math.round(spec.size * (1 - 2 * (spec.pad ?? 0.05))), null);
  if (spec.t === 'adaptive') return place(ROBOT, spec.size, Math.round(spec.size * 0.60), null);
  if (spec.t === 'white')    return place(WHITE, spec.size, Math.round(spec.size * 0.72), null);
  if (spec.t === 'splash') {
    const ip = Math.round(spec.w * spec.scale);
    const r = await sharp(ROBOT).resize(ip, ip, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
    return blank(spec.w, spec.h, { r: 14, g: 14, b: 16, alpha: 1 })
      .composite([{ input: r, left: Math.round((spec.w - ip) / 2), top: Math.round((spec.h - ip) / 2) }])
      .flatten({ background: DARK }).removeAlpha().png().toBuffer();
  }
  throw new Error('unknown spec ' + spec.t);
}
async function macTile(size) {
  const ip = Math.round(size * 0.62);
  const r = await sharp(ROBOT).resize(ip, ip, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  const rad = Math.round(size * 0.2237);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${rad}" ry="${rad}" fill="${DARK}"/></svg>`);
  const off = Math.round((size - ip) / 2);
  return sharp(await sharp(mask).png().toBuffer()).composite([{ input: r, left: off, top: off }]).png().toBuffer();
}
function icoEncode(items) {
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(items.length, 4);
  let off = 6 + 16 * items.length; const ents = [], datas = [];
  for (const { size, buf } of items) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(off, 12);
    ents.push(e); datas.push(buf); off += buf.length;
  }
  return Buffer.concat([head, ...ents, ...datas]);
}
function icnsEncode(items) {
  const chunks = items.map(({ type, buf }) => { const h = Buffer.alloc(8); h.write(type, 0, 'ascii'); h.writeUInt32BE(8 + buf.length, 4); return Buffer.concat([h, buf]); });
  const body = Buffer.concat(chunks); const fh = Buffer.alloc(8); fh.write('icns', 0, 'ascii'); fh.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([fh, body]);
}

// path -> raster spec
const PNG_TARGETS = [
  ['mobile-app/assets/icon.png', { t: 'tile', size: 1024 }],
  ['mobile-app/assets/images/icon.png', { t: 'tile', size: 1024 }],
  ['mobile-app/store/design/icon-1024-appstore.png', { t: 'tile', size: 1024 }],
  ['mobile-app/assets/adaptive-icon.png', { t: 'adaptive', size: 1024 }],
  ['mobile-app/assets/images/adaptive-icon.png', { t: 'adaptive', size: 1024 }],
  ['mobile-app/assets/favicon.png', { t: 'transp', size: 96, pad: 0.06 }],
  ['mobile-app/assets/images/favicon.png', { t: 'transp', size: 48, pad: 0.06 }],
  ['mobile-app/assets/notification_icon.png', { t: 'white', size: 96 }],
  ['mobile-app/assets/splash-icon.png', { t: 'transp', size: 512, pad: 0.08 }],
  ['mobile-app/assets/splash-icon-dark.png', { t: 'transp', size: 512, pad: 0.08 }],
  ['mobile-app/assets/images/splash-icon.png', { t: 'transp', size: 200, pad: 0.08 }],
  ['mobile-app/assets/splash.png', { t: 'splash', w: 1242, h: 2436, scale: 0.30 }],
  ['public/favicon.png', { t: 'transp', size: 128, pad: 0.04 }],
  ['public/apple-touch-icon.png', { t: 'tile', size: 180 }],
  ['extensions/aisha-dirigent/resources/icon.png', { t: 'tile', size: 256 }],
  ['workbench/src/stable/resources/linux/code.png', { t: 'transp', size: 512, pad: 0.04 }],
  ['workbench/src/stable/resources/linux/code-icons/16x16.png', { t: 'transp', size: 16, pad: 0.02 }],
  ['workbench/src/stable/resources/linux/code-icons/32x32.png', { t: 'transp', size: 32, pad: 0.03 }],
  ['workbench/src/stable/resources/linux/code-icons/48x48.png', { t: 'transp', size: 48, pad: 0.04 }],
  ['workbench/src/stable/resources/linux/code-icons/64x64.png', { t: 'transp', size: 64, pad: 0.04 }],
  ['workbench/src/stable/resources/linux/code-icons/128x128.png', { t: 'transp', size: 128, pad: 0.04 }],
  ['workbench/src/stable/resources/linux/code-icons/256x256.png', { t: 'transp', size: 256, pad: 0.04 }],
  ['workbench/src/stable/resources/linux/code-icons/512x512.png', { t: 'transp', size: 512, pad: 0.04 }],
];
// path -> svg (robot-on-dark-circle logo mark)
const SVG_TARGETS = [
  'public/aisha.svg',
  'extensions/aisha-dirigent/resources/icon.svg',
  'workbench/icons/stable/aisha_logo.svg',
  'packages/n8n-nodes-aisha/nodes/AishaAdminBridge/aisha.svg',
  'packages/n8n-nodes-aisha/nodes/AishaGitHubApp/aisha.svg',
  'packages/n8n-nodes-aisha/nodes/AishaRpc/aisha.svg',
  'scripts/setup-cockpit/ui/aisha-mark.svg',
];

async function main() {
  ROBOT = await trimmedOf(master);
  WHITE = await trimmedOf(whiteSVG);
  let n = 0;
  for (const [rel, spec] of PNG_TARGETS) { fs.writeFileSync(path.join(ROOT, rel), await render(spec)); n++; }
  for (const rel of SVG_TARGETS) { fs.writeFileSync(path.join(ROOT, rel), logoSVG); n++; }
  // favicon.ico (PNG-in-ICO 16/32/48 dark tiles)
  const ico = []; for (const sz of [16, 32, 48]) ico.push({ size: sz, buf: await render({ t: 'tile', size: sz }) });
  fs.writeFileSync(path.join(ROOT, 'public/favicon.ico'), icoEncode(ico)); n++;
  // workbench macOS .icns (rounded squircle)
  const icns = icnsEncode([
    { type: 'ic10', buf: await macTile(1024) }, { type: 'ic09', buf: await macTile(512) },
    { type: 'ic08', buf: await macTile(256) }, { type: 'ic07', buf: await macTile(128) },
    { type: 'ic12', buf: await macTile(64) }, { type: 'ic11', buf: await macTile(32) },
  ]);
  fs.writeFileSync(path.join(ROOT, 'workbench/src/stable/resources/darwin/code.icns'), icns); n++;
  console.log(`gen-icons: wrote ${n} assets from brand/aisha-icon.svg`);
}
main().catch((e) => { console.error(e); process.exit(1); });
