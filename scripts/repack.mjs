// repack.mjs — rebuild an APK without touching dex / resources.arsc:
//   * patch AndroidManifest.xml (label override, remove launcher entry,
//     excludeFromRecents on activities)
//   * replace launcher icon bitmaps with the "system desktop" disguise art
// All other entries are byte-preserved (compression kept).
//   node repack.mjs <original.apk> <out.apk> [--label 系统桌面]
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { patchManifest } from '../lib/axml_patch_core.mjs';
import { launcherIconPng, launcherForegroundPng } from '../lib/art.mjs';

// ---------------- zip reading helpers ----------------
const SIG_EOCD = 0x06054b50, SIG_CEN = 0x02014b50, SIG_LOC = 0x04034b50;

function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new Error('EOCD not found (not a zip?)');
}

function readCentral(buf) {
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOff = buf.readUInt32LE(eocd + 16);
  const entries = [];
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== SIG_CEN) throw new Error('bad central header');
    const entry = {
      method: buf.readUInt16LE(p + 10),
      flags: buf.readUInt16LE(p + 8),
      crc: buf.readUInt32LE(p + 16),
      csize: buf.readUInt32LE(p + 20),
      usize: buf.readUInt32LE(p + 24),
      nameLen: buf.readUInt16LE(p + 28),
      extraLen: buf.readUInt16LE(p + 30),
      commentLen: buf.readUInt16LE(p + 32),
      diskStart: buf.readUInt16LE(p + 34),
      intAttr: buf.readUInt16LE(p + 36),
      extAttr: buf.readUInt32LE(p + 38),
      localOff: buf.readUInt32LE(p + 42),
    };
    entry.name = buf.toString('utf8', p + 46, p + 46 + entry.nameLen);
    entry.extra = buf.subarray(p + 46 + entry.nameLen, p + 46 + entry.nameLen + entry.extraLen);
    entry.comment = buf.subarray(p + 46 + entry.nameLen + entry.extraLen, p + 46 + entry.nameLen + entry.extraLen + entry.commentLen);
    // locate data
    const lp = entry.localOff;
    const lNameLen = buf.readUInt16LE(lp + 26);
    const lExtraLen = buf.readUInt16LE(lp + 28);
    const dataStart = lp + 30 + lNameLen + lExtraLen;
    if (dataStart + entry.csize > buf.length) throw new Error(`bad local data for ${entry.name}`);
    entry.data = buf.subarray(dataStart, dataStart + entry.csize);
    entries.push(entry);
    p += 46 + entry.nameLen + entry.extraLen + entry.commentLen;
  }
  return entries;
}

// ---------------- crc32 ----------------
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// PNG dimension reader (for regenerating at the exact original pixel size)
function pngDims(b) {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// ---------------- main ----------------
const [inApk, outApk] = process.argv.slice(2);
const labelArgIdx = process.argv.indexOf('--label');
const LABEL = labelArgIdx >= 0 ? process.argv[labelArgIdx + 1] : '系统桌面';
const KEEP_LAUNCHER = process.argv.includes('--keep-launcher');

const original = readFileSync(inApk);
const entries = readCentral(original);

const manifestResult = { patched: false, stats: null };
const iconStats = { legacy: 0, foreground: 0, keptPng: 0 };
const replacements = new Map(); // name -> Buffer(raw content)

for (const e of entries) {
  const name = e.name;
  if (name === 'AndroidManifest.xml') {
    const raw = inflateRawSync(e.data);
    const res = patchManifest(raw, { label: LABEL, removeLauncher: !KEEP_LAUNCHER });
    replacements.set(name, res.buf);
    manifestResult.patched = true;
    manifestResult.stats = res.stats;
    continue;
  }
  const base = name.split('/').pop() || '';
  const isLegacy = /^ic_launcher(_round)?\.png$/.test(base);
  const isFg = /^ic_launcher_foreground\.png$/.test(base);
  const isBg = /^ic_launcher_background\.(png|webp)$/.test(base);
  if (/^res\/mipmap/.test(name) && (isLegacy || isFg || isBg)) {
    const dims = pngDims(e.method === 0 ? e.data : inflateRawSync(e.data));
    if (dims && dims.w === dims.h) {
      const png = isFg
        ? launcherForegroundPng(dims.w)
        : (isBg ? launcherIconPng(dims.w) : launcherIconPng(dims.w));
      replacements.set(name, png);
      if (isFg) iconStats.foreground++; else if (isBg) iconStats.keptPng++; else iconStats.legacy++;
    } else {
      console.warn(`skip icon ${name} (not square or unreadable)`);
    }
  }
}

if (!manifestResult.patched) throw new Error('AndroidManifest.xml not found in apk!');
console.log('manifest stats:', manifestResult.stats);
console.log('icons replaced :', iconStats);

// ---------------- write new zip ----------------
const outChunks = [];
const central = [];
let offset = 0;

const now = new Date();
const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

function emitEntry(name, content, { method } = {}) {
  // content is raw bytes; store => method 0 ; otherwise deflate
  const raw = content;
  let data, csize, crc;
  if (method === 0) {
    data = raw; csize = raw.length; crc = crc32(raw);
  } else {
    data = deflateRawSync(raw, { level: 9 });
    csize = data.length; crc = crc32(raw);
  }
  const nameBuf = Buffer.from(name, 'utf8');
  // pad local extra so data starts 4-aligned when stored
  let pad = 0;
  if (method === 0) pad = (4 - ((offset + 30 + nameBuf.length) % 4)) % 4;

  const loc = Buffer.alloc(30);
  loc.writeUInt32LE(SIG_LOC, 0);
  loc.writeUInt16LE(20, 4);
  loc.writeUInt16LE(0, 6);          // flags (no descriptor)
  loc.writeUInt16LE(method === 0 ? 0 : 8, 8);
  loc.writeUInt16LE(dosTime, 10);
  loc.writeUInt16LE(dosDate, 12);
  loc.writeUInt32LE(crc, 14);
  loc.writeUInt32LE(csize, 18);
  loc.writeUInt32LE(raw.length, 22);
  loc.writeUInt16LE(nameBuf.length, 26);
  loc.writeUInt16LE(pad, 28);
  const extra = Buffer.alloc(pad);
  outChunks.push(loc, nameBuf, extra, data);
  const dataOff = offset + 30 + nameBuf.length + pad;
  if (method === 0 && dataOff % 4 !== 0) throw new Error('alignment bug');
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(SIG_CEN, 0);
  cen.writeUInt16LE(20, 4);   // made by
  cen.writeUInt16LE(20, 6);   // needed
  cen.writeUInt16LE(0, 8);    // flags
  cen.writeUInt16LE(method === 0 ? 0 : 8, 10);
  cen.writeUInt16LE(dosTime, 12);
  cen.writeUInt16LE(dosDate, 14);
  cen.writeUInt32LE(crc, 16);
  cen.writeUInt32LE(csize, 20);
  cen.writeUInt32LE(raw.length, 24);
  cen.writeUInt16LE(nameBuf.length, 28);
  cen.writeUInt16LE(0, 30);   // extra len (central)
  cen.writeUInt16LE(0, 32);   // comment len
  cen.writeUInt16LE(0, 34);   // disk start
  cen.writeUInt16LE(0, 36);   // internal attrs
  cen.writeUInt32LE(0, 38);   // external attrs
  cen.writeUInt32LE(offset, 42);
  central.push(Buffer.concat([cen, nameBuf]));
  offset += 30 + nameBuf.length + pad + data.length;
}

for (const e of entries) {
  const rep = replacements.get(e.name);
  if (rep !== undefined) {
    emitEntry(e.name, rep, { method: 8 });
    continue;
  }
  // preserve untouched entry: raw bytes + original method
  const raw = e.method === 0 ? e.data : inflateRawSync(e.data);
  emitEntry(e.name, raw, { method: e.method });
}

const cdStart = offset;
const cdBuf = Buffer.concat(central);
offset += cdBuf.length;
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(SIG_EOCD, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(entries.length, 8);
eocd.writeUInt16LE(entries.length, 10);
eocd.writeUInt32LE(cdBuf.length, 12);
eocd.writeUInt32LE(cdStart, 16);
eocd.writeUInt16LE(0, 20);

writeFileSync(outApk, Buffer.concat([...outChunks, cdBuf, eocd]));
console.log(`written ${outApk} (${offset + 22} bytes, ${entries.length} entries)`);
