const fs = require('fs');

const filePath = 'src/_data/sources.json';
const outPath = 'src/_data/sources.deduped.json';
const raw = fs.readFileSync(filePath, 'utf8');
const lines = raw.split('\n');

const keyLineRe = /^  "([^"]+)":\s*\{/;
const closeLineRe = /^\s{2}\},?\s*$/;

let blocks = [];
let i = 0;
while (i < lines.length) {
  const m = lines[i].match(keyLineRe);
  if (m) {
    const key = m[1];
    const start = i;
    let j = i + 1;
    while (j < lines.length && !closeLineRe.test(lines[j])) j++;
    blocks.push({ key, start, end: j });
    i = j + 1;
  } else {
    i++;
  }
}

const byKey = {};
for (const b of blocks) (byKey[b.key] = byKey[b.key] || []).push(b);

const conflicts = [];
const toRemove = [];

for (const key in byKey) {
  const arr = byKey[key];
  if (arr.length <= 1) continue;
  const texts = arr.map(b => lines.slice(b.start, b.end + 1).join('\n').replace(/,\s*$/, ''));
  const allSame = texts.every(t => t === texts[0]);
  if (allSame) {
    for (let k = 0; k < arr.length - 1; k++) toRemove.push(arr[k]);
  } else {
    conflicts.push(key);
  }
}

const removeLineSet = new Set();
for (const b of toRemove) for (let ln = b.start; ln <= b.end; ln++) removeLineSet.add(ln);

const outLines = lines.filter((_, idx) => !removeLineSet.has(idx));
fs.writeFileSync(outPath, outLines.join('\n'), 'utf8');

console.log(`Removed ${toRemove.length} duplicate block(s).`);
console.log(`Left untouched (content differs, needs your review): ${conflicts.join(', ') || 'none'}`);
console.log(`Wrote cleaned file to ${outPath}`);
