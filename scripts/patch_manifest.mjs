// patch_manifest.mjs — CLI wrapper around lib/axml_patch_core.mjs
//   node patch_manifest.mjs <in.xml> <out.xml> [label] [--keep-launcher]
import { readFileSync, writeFileSync } from 'node:fs';
import { patchManifest } from '../lib/axml_patch_core.mjs';

const args = process.argv.slice(2);
const inFile = args[0], outFile = args[1];
const labelIdx = args.indexOf('--label');
const keepLauncher = args.includes('--keep-launcher');
const label = labelIdx >= 0 ? args[labelIdx + 1] : args[2] || '系统桌面';
const { buf, stats } = patchManifest(readFileSync(inFile), { label, removeLauncher: !keepLauncher });
writeFileSync(outFile, buf);
console.log(`${inFile} -> ${outFile} (${buf.length} bytes)`);
console.log(`launcher-filter chunks dropped : ${stats.launcherDropped}`);
console.log(`excludeFromRecents added to    : ${stats.excludeAdded} components`);
