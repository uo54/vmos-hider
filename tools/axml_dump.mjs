// AXML dump v2: handles 16-byte ResXMLTree_node prefix (lineNumber+comment).
// Usage: node axml_dump.mjs <file.axml>
import { readFileSync } from 'node:fs';

const buf = readFileSync(process.argv[2]);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

const u16 = (o) => dv.getUint16(o, true);
const u32 = (o) => dv.getUint32(o, true);

const TYPE_STRING = 0x0001, TYPE_STARTNS = 0x0100, TYPE_ENDNS = 0x0101,
      TYPE_START = 0x0102, TYPE_ENDEL = 0x0103;

let stringPool = null;
function readStringPool(o) {
  const count = u32(o + 8), flags = u32(o + 16), strStart = u32(o + 20);
  const isUtf8 = (flags & 0x100) !== 0;
  const strs = [];
  for (let i = 0; i < count; i++) {
    const so = u32(o + 28 + i * 4);
    const p = o + strStart + so;
    if (isUtf8) {
      let q = p;
      let len = buf[q++];
      if (len & 0x80) len = ((len & 0x7f) << 8) | buf[q++];
      let clen = buf[q++];
      if (clen & 0x80) clen = ((clen & 0x7f) << 8) | buf[q++];
      strs.push(buf.subarray(q, q + len).toString('utf8'));
    } else {
      let q = p;
      let len = u16(q); q += 2;
      if (len & 0x8000) { len = ((len & 0x7fff) << 16) | u16(q); q += 2; }
      strs.push(buf.subarray(q, q + len * 2).toString('utf16le'));
    }
  }
  return strs;
}
const s = (i) => (stringPool && i >= 0 && i < stringPool.length) ? stringPool[i] : null;

const ATTR = {
  0x01010000:'package',0x01010001:'versionCode',0x01010210:'versionName',0x01010002:'versionCodeMajor',
  0x01010003:'name',0x01010004:'label',0x01010005:'icon',0x0101000e:'permission',0x0101000f:'exported',
  0x01010010:'process',0x0101001c:'enabled',0x0101001d:'debuggable',0x01010020:'theme',
  0x01010024:'targetSdkVersion',0x01010021:'minSdkVersion',0x0101001a:'allowBackup',0x01010026:'supportsRtl',
  0x010100e0:'finishOnTaskLaunch',0x010100ef:'noHistory',0x010102c6:'requestLegacyExternalStorage',
  0x0101021b:'usesCleartextTraffic',0x01010047:'configChanges',0x010100e9:'launchMode',
  0x01010124:'taskAffinity',0x01010034:'screenOrientation',0x0101040c:'excludeFromRecents',
  0x0101043c:'resizeableActivity',0x010100d1:'directBootAware',0x010103eb:'use32bitAbi',
  0x0101042f:'networkSecurityConfig',0x010103d3:'fullBackupContent',0x010100bc:'singleUser',
  0x010100d7:'stopWithTask',0x0101020f:'isSplitRequired',0x01010235:'extractNativeLibs',
  0x010103d2:'enableOnBackInvokedCallback',0x01010233:'requestRawExternalStorageAccess',
  0x01010252:'localeConfig',0x010100c4:'windowSoftInputMode',0x0101003c:'theme',0x01010008:'authorities',
  0x0101000a:'resource',0x01010006:'value',0x01010254:'enableOnBackInvokedCallback',
  0x0101002a:'exported',0x01010029:'description',0x0101004c:'grantUriPermissions',
  0x01010027:'readPermission',0x01010028:'writePermission',0x01010052:'multiprocess',
  0x01010011:'stateNotNeeded',0x01010033:'killAfterProcess',0x0101009a:'initOrder',
  0x0101022d:'foregroundServiceType',0x01010049:'isolatedProcess',0x01010054:'externalService',
  0x01010497:'useEmbeddedDex',0x0101045b:'hasCode',0x01010009:'scheme',0x01010007:'host',
  0x0101000b:'pathPrefix',0x0101000d:'port',0x0101000c:'mimeType',0x01010453:'path',
  0x01010454:'pathPattern',0x01010012:'state',0x01010013:'category',0x01010002:'versionCode',
};
function attrName(id) { return ATTR[id] || ('0x' + id.toString(16)); }

function valStr(dtype, d) {
  if (dtype === 0x10) return String(d);               // TYPE_INT_DEC
  if (dtype === 0x11) return '0x' + d.toString(16);   // TYPE_INT_HEX
  if (dtype === 0x12) return d === 0 ? 'false' : 'true'; // TYPE_INT_BOOLEAN
  if (dtype === 0x01) return '@' + (d >>> 0).toString(16); // reference
  if (dtype >= 0x1c && dtype <= 0x1f) return '#' + d.toString(16).padStart(8, '0'); // color
  if (dtype === 0x03) return 'str#' + d;             // TYPE_STRING
  return 't' + dtype.toString(16) + ':' + d.toString(16);
}

if (u32(0) !== 0x00080003) { console.error('not an AXML file'); process.exit(1); }

let off = 8;
const out = [];
let depth = 0;
while (off < buf.length) {
  const type = u16(off), hdr = u16(off + 2), size = u32(off + 4);
  if (type === TYPE_STRING) {
    stringPool = readStringPool(off);
  } else if (type === TYPE_START) {
    // node(16: type/hdr/size/line/comment) + ext: ns(4) name(4) attrStart(2)...
    const ns = u32(off + 16), name = u32(off + 20);
    const attrStart = u16(off + 24), attrSize = u16(off + 26), attrCount = u16(off + 28);
    const nm = s(name) ?? '?';
    const attrs = [];
    let a = off + 16 + attrStart;
    for (let i = 0; i < attrCount; i++) {
      const ans = u32(a), an = u32(a + 4), raw = u32(a + 8);
      const dtype = buf[a + 15], d = u32(a + 16);
      let key = an >= 0x01010000 ? attrName(an) : (s(an) ?? ('name#' + an));
      const rawStr = raw !== 0xffffffff ? s(raw) : null;
      const val = rawStr != null ? `"${rawStr}"` : valStr(dtype, d);
      attrs.push(`${key}=${val}`);
      a += attrSize;
    }
    out.push('  '.repeat(depth) + '<' + nm + ' ' + attrs.join(' ') + '>');
    depth++;
  } else if (type === TYPE_ENDEL) {
    depth = Math.max(0, depth - 1);
    const name = u32(off + 20);
    out.push('  '.repeat(depth) + '</' + (s(name) ?? '?') + '>');
  }
  off += size;
}
console.log(out.join('\n'));
