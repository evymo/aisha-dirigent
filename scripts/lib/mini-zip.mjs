/**
 * @module mini-zip
 * Zero-dependency ZIP archive writer (store + deflate), enough to pack an MCP
 * Bundle (.mcpb) without relying on a system `zip` binary. Produces a standard
 * PKZIP archive readable by Claude Desktop, macOS Archive Utility, and unzip.
 *
 * Deterministic: fixed DOS timestamp so identical inputs yield identical bytes.
 */

import { deflateRawSync } from "node:zlib";
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

// CRC-32 (IEEE) table + function.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Fixed DOS date/time: 1980-01-01 00:00:00 (deterministic builds).
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

/**
 * Recursively collect files under `baseDir` for the given top-level entries.
 * @param {string} baseDir
 * @param {string[]} entries  file or directory names relative to baseDir
 * @returns {Array<{ name: string, abs: string }>}  name uses POSIX separators
 */
export function collectFiles(baseDir, entries) {
  const out = [];
  const walk = (abs, rel) => {
    const st = statSync(abs);
    if (st.isDirectory()) {
      for (const child of readdirSync(abs).sort()) {
        if (child === ".DS_Store") continue;
        walk(path.join(abs, child), `${rel}/${child}`);
      }
    } else {
      out.push({ name: rel, abs });
    }
  };
  for (const entry of entries.slice().sort()) {
    walk(path.join(baseDir, entry), entry);
  }
  return out;
}

/**
 * Write a ZIP archive.
 * @param {string} outFile
 * @param {Array<{ name: string, abs: string }>} files
 * @returns {number} archive size in bytes
 */
export function writeZip(outFile, files) {
  const localParts = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const data = readFileSync(f.abs);
    const crc = crc32(data);
    const compressed = deflateRawSync(data);
    const nameBuf = Buffer.from(f.name, "utf-8");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    localParts.push(local, nameBuf, compressed);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); // central dir signature
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8); // flags
    cd.writeUInt16LE(8, 10); // method
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra len
    cd.writeUInt16LE(0, 32); // comment len
    cd.writeUInt16LE(0, 34); // disk number start
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs (regular file, 0644)
    cd.writeUInt32LE(offset, 42); // local header offset
    central.push(Buffer.concat([cd, nameBuf]));

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // disk with CD
  eocd.writeUInt16LE(files.length, 8); // entries on disk
  eocd.writeUInt16LE(files.length, 10); // total entries
  eocd.writeUInt32LE(centralBuf.length, 12); // CD size
  eocd.writeUInt32LE(offset, 16); // CD offset
  eocd.writeUInt16LE(0, 20); // comment len

  const archive = Buffer.concat([...localParts, centralBuf, eocd]);
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, archive);
  return archive.length;
}
