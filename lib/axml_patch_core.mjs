// axml_patch_core.mjs — re-usable AndroidManifest.xml stealth patcher.
import { parseAxml, makeAttrBytes, elementWithAddedAttr } from './axml.mjs';

const ATTRNAME_ID = {
  0x01010004: 'label', 0x01010003: 'name', 0x0101000f: 'exported',
  0x0101040c: 'excludeFromRecents', 0x01010013: 'category',
};

export function patchManifest(buf, { label = '系统桌面', removeLauncher = true, addNoHistory = true } = {}) {
  const ax = parseAxml(buf);
  const { pool, chunks } = ax;
  const s = (i) => (pool && i >= 0 && i < pool.strs.length) ? pool.strs[i] : null;
  const attrText = (an) =>
    (an >= 0 && an < pool.strs.length) ? pool.strs[an] : (ATTRNAME_ID[an] ?? null);

  const readAttr = (c) => {
    const buf = c && c.data ? c.data : c; // accept chunk {data} or raw Buffer
    const attrStart = buf.readUInt16LE(24);
    const attrSize = buf.readUInt16LE(26);
    const attrCount = buf.readUInt16LE(28);
    const list = [];
    let a = 16 + attrStart;
    for (let k = 0; k < attrCount; k++) {
      const an = buf.readUInt32LE(a + 4);
      list.push({
        off: a, ns: buf.readUInt32LE(a), text: attrText(an),
        raw: buf.readUInt32LE(a + 8), dtype: buf[a + 15], data: buf.readUInt32LE(a + 16),
      });
      a += attrSize;
    }
    return list;
  };

  // element tree
  const startMap = new Map();
  const roots = [];
  {
    const stack = [];
    chunks.forEach((c, i) => {
      if (c.type === 0x0102) {
        const tag = s(c.data.readUInt32LE(20));
        const node = { i, tag, children: [], parent: stack.length ? stack[stack.length - 1] : null, endOrd: -1 };
        if (node.parent) node.parent.children.push(node); else roots.push(node);
        stack.push(node);
        startMap.set(i, node);
      } else if (c.type === 0x0103) {
        const top = stack.pop();
        if (top) top.endOrd = i;
      }
    });
  }

  const catIsLauncher = (node) =>
    readAttr(chunks[node.i]).some((at) => at.text === 'name' && at.raw !== 0xffffffff && s(at.raw) === 'android.intent.category.LAUNCHER');

  const dropSet = new Set();
  if (removeLauncher) {
    (function scan(node) {
      const inApp = node.parent && node.parent.tag === 'application';
      if ((node.tag === 'activity' || node.tag === 'activity-alias') && inApp) {
        for (const f of node.children) {
          if (f.tag === 'intent-filter' && f.children.some((g) => g.tag === 'category' && catIsLauncher(g))) {
            for (let i = f.i; i <= f.endOrd; i++) dropSet.add(i);
          }
        }
      }
      node.children.forEach(scan);
    })(...roots);
  }

  function encodeStringPool(strs) {
    const dataParts = [];
    const offsets = [];
    let pos = 0;
    for (const str of strs) {
      offsets.push(pos);
      const bytes = Buffer.from(str, 'utf16le');
      const hdr = Buffer.alloc(2);
      hdr.writeUInt16LE(bytes.length / 2);
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
    header.writeUInt16LE(0x0001, 0);
    header.writeUInt16LE(28, 2);
    header.writeUInt32LE(size, 4);
    header.writeUInt32LE(strs.length, 8);
    header.writeUInt32LE(0, 12);
    header.writeUInt32LE(0, 16);
    header.writeUInt32LE(28 + offsetsBuf.length, 20);
    header.writeUInt32LE(0, 24);
    offsetsBuf.copy(header, 28);
    data.copy(header, 28 + offsetsBuf.length);
    return header;
  }

  const appLabelIdx = pool.strs.length;
  const newPool = encodeStringPool(pool.strs.concat([label]));
  const outChunks = [];
  let launcherDropped = 0, excludeAdded = 0;

  chunks.forEach((c, i) => {
    if (c.type === 0x0001) return;
    if (dropSet.has(i)) { launcherDropped++; return; }
    if (c.type !== 0x0102) { outChunks.push(c.data); return; }

    const tag = s(c.data.readUInt32LE(20));
    let d = c.data;

    if (tag === 'application') {
      const attrs = readAttr(c);
      const lbl = attrs.find((at) => at.text === 'label');
      if (lbl) {
        d = Buffer.from(d);
        d.writeUInt32LE(appLabelIdx, lbl.off + 8);
        d[lbl.off + 15] = 0x03;
        d.writeUInt32LE(appLabelIdx, lbl.off + 16);
      } else {
        console.error('WARN: no android:label attr on <application>');
      }
    }

    const node = startMap.get(i);
    if ((tag === 'activity' || tag === 'activity-alias') && node && node.parent && node.parent.tag === 'application') {
      const attrs = readAttr(c);
      // android:excludeFromRecents=true
      if (!attrs.some((at) => at.text === 'excludeFromRecents')) {
        let ns = 0xffffffff;
        const exp = attrs.find((at) => at.text === 'exported');
        if (exp) ns = exp.ns;
        const nameIdx = pool.strs.indexOf('excludeFromRecents');
        const an = nameIdx >= 0 ? nameIdx : 0x01010017;
        d = elementWithAddedAttr(d, makeAttrBytes(ns, an, 0x12, 0xffffffff));
        excludeAdded++;
      }
      // android:noHistory=true —— 回桌面即结束界面，任务不留痕
      if (addNoHistory && !attrs.some((at) => at.text === 'noHistory')) {
        const attrs2 = readAttr(d);
        let ns2 = 0xffffffff;
        const exp2 = attrs2.find((at) => at.text === 'exported');
        if (exp2) ns2 = exp2.ns;
        const nameIdx2 = pool.strs.indexOf('noHistory');
        const an2 = nameIdx2 >= 0 ? nameIdx2 : 0x010100ef;
        d = elementWithAddedAttr(d, makeAttrBytes(ns2, an2, 0x12, 0xffffffff));
      }
    }
    outChunks.push(d);
  });

  let total = 8 + newPool.length;
  outChunks.forEach((p) => (total += p.length));
  const head = Buffer.alloc(8);
  head.writeUInt32LE(0x00080003, 0);
  head.writeUInt32LE(total, 4);
  return {
    buf: Buffer.concat([head, newPool, ...outChunks]),
    stats: { launcherDropped, excludeAdded },
  };
}
