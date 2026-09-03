// axml.mjs — read/parse and binary-patch Android binary XML (AXML).
// Used for AndroidManifest.xml surgery: label override, removing launcher
// entry, excludeFromRecents on activities. Pure Node, no dependencies.
import { readFileSync, writeFileSync } from 'node:fs';

const TYPE_STRING = 0x0001, TYPE_RESMAP = 0x0180,
      TYPE_STARTNS = 0x0100, TYPE_ENDNS = 0x0101,
      TYPE_START = 0x0102, TYPE_ENDEL = 0x0103, TYPE_CDATA = 0x0104;

// ---------------------------------------------------------------------------
export function parseAxml(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u16 = (o) => dv.getUint16(o, true);
  const u32 = (o) => dv.getUint32(o, true);

  if (u32(0) !== 0x00080003) throw new Error('not an AXML file');

  // string pool
  const readPool = (o) => {
    const size = u32(o + 4);
    const count = u32(o + 8);
    const flags = u32(o + 16);
    const strStart = u32(o + 20);
    const isUtf8 = (flags & 0x100) !== 0;
    const strs = [];
    for (let i = 0; i < count; i++) {
      const so = u32(o + 28 + i * 4);
      const p = o + strStart + so;
      if (isUtf8) {
        let q = p;
        let len = buf[q++];
        if (len & 0x80) len = ((len & 0x7f) << 8) | buf[q++];
        q++; // charLen (skip)
        strs.push(buf.subarray(q, q + len).toString('utf8'));
      } else {
        let q = p;
        let len = u16(q); q += 2;
        if (len & 0x8000) { len = ((len & 0x7fff) << 16) | u16(q); q += 2; }
        strs.push(buf.subarray(q, q + len * 2).toString('utf16le'));
      }
    }
    return { size, flags, strs };
  };

  // scan chunks, keep descriptors
  const chunks = [];
  let pool = null;
  let off = 8;
  while (off < buf.length) {
    const type = u16(off), hdrSize = u16(off + 2), size = u32(off + 4);
    if (type === TYPE_STRING) pool = readPool(off);
    chunks.push({ type, hdrSize, size, start: off, data: buf.subarray(off, off + size) });
    off += size;
  }
  return { buf, pool, chunks };
}

// Decode element tree with attributes for downstream inspection.
export function tree(ax) {
  const { pool, chunks } = ax;
  const s = (i) => (pool && i >= 0 && i < pool.strs.length) ? pool.strs[i] : null;
  const ATTR = {
    0x01010000:'package',0x01010001:'versionCode',0x01010210:'versionName',0x01010003:'name',
    0x01010004:'label',0x01010005:'icon',0x0101000e:'permission',0x0101000f:'exported',
    0x01010010:'process',0x0101001c:'enabled',0x0101001d:'debuggable',0x01010020:'theme',
    0x01010024:'targetSdkVersion',0x01010021:'minSdkVersion',0x0101001a:'allowBackup',
    0x01010026:'supportsRtl',0x010100e0:'finishOnTaskLaunch',0x010100ef:'noHistory',
    0x010102c6:'requestLegacyExternalStorage',0x0101021b:'usesCleartextTraffic',
    0x01010047:'configChanges',0x010100e9:'launchMode',0x01010124:'taskAffinity',
    0x01010034:'screenOrientation',0x0101040c:'excludeFromRecents',0x0101043c:'resizeableActivity',
    0x010100d1:'directBootAware',0x010103eb:'use32bitAbi',0x0101042f:'networkSecurityConfig',
    0x010103d3:'fullBackupContent',0x010100bc:'singleUser',0x010100d7:'stopWithTask',
    0x0101020f:'isSplitRequired',0x01010235:'extractNativeLibs',0x010103d2:'enableOnBackInvokedCallback',
    0x01010252:'localeConfig',0x010100c4:'windowSoftInputMode',0x0101003c:'theme',
    0x01010008:'authorities',0x0101000a:'resource',0x01010006:'value',0x01010009:'scheme',
    0x01010007:'host',0x0101000b:'pathPrefix',0x0101000d:'port',0x0101000c:'mimeType',
    0x01010453:'path',0x01010454:'pathPattern',0x01010012:'state',0x01010013:'category',
    0x01010029:'description',0x0101004c:'grantUriPermissions',0x01010027:'readPermission',
    0x01010028:'writePermission',0x01010052:'multiprocess',0x01010011:'stateNotNeeded',
    0x01010033:'killAfterProcess',0x0101009a:'initOrder',0x0101022d:'foregroundServiceType',
    0x01010049:'isolatedProcess',0x01010054:'externalService',0x0101045b:'hasCode',
    0x01010002:'versionCodeMajor',0x01010497:'useEmbeddedDex',
  };
  const attrName = (id) => ATTR[id] || ('0x' + id.toString(16));
  const vstr = (dtype, d) => {
    if (dtype === 0x10) return '' + d;
    if (dtype === 0x11) return '0x' + d.toString(16);
    if (dtype === 0x12) return d ? 'true' : 'false';
    if (dtype === 0x01) return '@' + (d >>> 0).toString(16);
    if (dtype === 0x03) return 'str#' + d;
    if (dtype >= 0x1c && dtype <= 0x1f) return '#' + d.toString(16).padStart(8, '0');
    return 't' + dtype.toString(16) + ':' + d.toString(16);
  };
  const stack = [];
  const out = [];
  for (const c of chunks) {
    if (c.type === TYPE_START) {
      const name = u32At(c.data, 20);
      const attrStart = c.data.readUInt16LE(24), attrSize = c.data.readUInt16LE(26), attrCount = c.data.readUInt16LE(28);
      const attrs = [];
      let a = 16 + attrStart;
      for (let i = 0; i < attrCount; i++) {
        const ans = c.data.readUInt32LE(a), an = c.data.readUInt32LE(a + 4), raw = c.data.readUInt32LE(a + 8);
        const dtype = c.data[a + 15], d = c.data.readUInt32LE(a + 16);
        const key = an >= 0x01010000 ? attrName(an) : (s(an) ?? ('name#' + an));
        const rawStr = raw !== 0xffffffff ? s(raw) : null;
        attrs.push({ key, raw: rawStr, dtype, d, _off: a });
        a += attrSize;
      }
      const el = { tag: s(name), attrs, _chunk: c, _attrsOff: a - attrSize };
      stack.push(el);
      out.push(el);
    } else if (c.type === TYPE_ENDEL) {
      stack.pop();
    }
  }
  return out;
}

const u32At = (b, o) => b.readUInt32LE(o);

// ---------------------------------------------------------------------------
// Encode an AXML from chunks; `patchFns` are applied on chunk descriptors.
// We only support: replace string pool (append), remove whole chunks,
// retype one attribute, insert an attribute record at the end of an element's
// attribute list. Return new Buffer of the whole file.
export function encodeAxml(ax, { newStrings = [], removeChunk = () => false, editElement = null } = {}) {
  const { pool, chunks } = ax;
  if (!pool) throw new Error('no string pool');

  const all = pool.strs.concat(newStrings);
  const poolChunk = encodeStringPool(all);
  const out = [Buffer.from([0x03, 0x00, 0x08, 0x00])];
  out.push(u32buf(poolChunk.length));
  out.push(poolChunk);

  for (const c of chunks) {
    if (c.type === TYPE_STRING) continue; // replaced above
    if (removeChunk(c)) continue;
    let d = c.data;
    if (c.type === TYPE_START && editElement) {
      const edited = editElement(c, pool.strs.length);
      if (edited) d = edited;
    }
    out.push(d);
  }
  return Buffer.concat(out);
}

export function encodeStringPool(strs) {
  const dataParts = [];
  const offsets = [];
  let pos = 0;
  for (const str of strs) {
    offsets.push(pos);
    const bytes = Buffer.from(str, 'utf16le');
    const lenChars = bytes.length / 2;
    const hdr = Buffer.alloc(2);
    hdr.writeUInt16LE(lenChars);
    dataParts.push(hdr, bytes);
    // aapt/Android expects each UTF-16 pool string NULL-terminated
    dataParts.push(Buffer.alloc(2));
    pos += 4 + bytes.length;
  }
  const offsetsBuf = Buffer.alloc(strs.length * 4);
  offsets.forEach((o, i) => offsetsBuf.writeUInt32LE(o, i * 4));
  const data = Buffer.concat(dataParts);
  const size = 28 + offsetsBuf.length + data.length;
  const header = Buffer.alloc(size);
  header.writeUInt16LE(TYPE_STRING, 0);
  header.writeUInt16LE(28, 2);
  header.writeUInt32LE(size, 4);
  header.writeUInt32LE(strs.length, 8);
  header.writeUInt32LE(0, 12);          // styleCount
  header.writeUInt32LE(0, 16);          // flags (utf-16)
  header.writeUInt32LE(28 + offsetsBuf.length, 20); // stringsStart
  header.writeUInt32LE(0, 24);          // stylesStart
  offsetsBuf.copy(header, 28);
  data.copy(header, 28 + offsetsBuf.length);
  return header;
}

const u32buf = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };

// Make an attribute record (20 bytes) from a template's ns + a name id + value.
export function makeAttrBytes(ns, attrNameId, dtype, data, raw = 0xffffffff) {
  const b = Buffer.alloc(20);
  b.writeUInt32LE(ns, 0);
  b.writeUInt32LE(attrNameId, 4);
  b.writeUInt32LE(raw, 8);
  b.writeUInt16LE(8, 12);   // typed value size
  b[14] = 0;                // res0
  b[15] = dtype;
  b.writeUInt32LE(data, 16);
  return b;
}

// Clone an element chunk with a new attr appended (attr record bytes given),
// returns Buffer. `attrTemplateOff` semantics not needed — we parse attrs.
export function elementWithAddedAttr(chunkData, attrRecord) {
  const attrStart = chunkData.readUInt16LE(24);
  const attrSize = chunkData.readUInt16LE(26);
  const attrCount = chunkData.readUInt16LE(28);
  const cur = chunkData.length;
  const newSize = cur + attrRecord.length;
  const out = Buffer.alloc(newSize);
  chunkData.copy(out);
  attrRecord.copy(out, cur);
  out.writeUInt16LE(attrCount + 1, 28);
  out.writeUInt32LE(newSize, 4);
  return out;
}
