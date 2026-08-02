#!/usr/bin/env node
/**
 * check_index_completeness.js
 *
 * Audits src/people/*.njk for named people in family.parents / family.spouses /
 * family.children who don't have their own url (i.e. no full built page), and
 * checks whether they already appear in src/_data/people-index.json.
 *
 * This is a BEST-EFFORT AUDIT, not a guarantee. Name matching is fuzzy —
 * nicknames, punctuation, and embedded dates can throw it off in either
 * direction. Review every line by hand; don't trust "MISSING" blindly, and
 * don't assume a name it calls "already indexed" is correctly indexed.
 *
 * Also remember the scope rule (set 2 Aug 2026): officiants, witnesses,
 * physicians, and record-keepers stay OUT of the index — they belong in
 * sources.json citation text only. This script doesn't know that distinction;
 * it only looks at family.parents/spouses/children, so it should never
 * surface those incidental roles in the first place, but double-check.
 *
 * Usage: node check_index_completeness.js
 */

const fs = require('fs');
const path = require('path');

let yaml;
try {
  yaml = require('js-yaml');
} catch (e) {
  console.error('This script needs js-yaml. Run: npm install js-yaml --save-dev');
  process.exit(1);
}

const PEOPLE_DIR = path.join(__dirname, 'src', 'people');
const INDEX_PATH = path.join(__dirname, 'src', '_data', 'people-index.json');

function extractFrontMatter(fileContent, fileName) {
  fileContent = fileContent.replace(/^\uFEFF/, ''); // strip BOM if present
  const match = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    console.error(`  ! ${fileName}: no front matter delimiters found`);
    return null;
  }
  try {
    return yaml.load(match[1]);
  } catch (e) {
    console.error(`  ! ${fileName}: YAML PARSE ERROR — ${e.message}`);
    return null;
  }
}
function normalize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/["'()]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function looksLikeRealPerson(entry) {
  if (!entry || !entry.name) return false;
  const n = entry.name.trim();
  if (n.startsWith('(')) return false; // pointer notes, e.g. "(see X's page...)"
  if (/living/i.test(n)) return false;
  if (/living/i.test(entry.birth_year || '')) return false;
  return true;
}

let indexData = {};
try {
  indexData = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
} catch (e) {
  console.error(`Could not read/parse ${INDEX_PATH}: ${e.message}`);
  process.exit(1);
}
const knownNames = Object.values(indexData).map(entry => normalize(entry.name));

function isLikelyIndexed(name) {
  const target = normalize(name);
  return knownNames.some(known =>
    known === target || known.includes(target) || target.includes(known)
  );
}

const files = fs.readdirSync(PEOPLE_DIR)
  .filter(f => f.endsWith('.njk') && f !== 'index.njk');

const findings = [];

for (const file of files) {
  const filePath = path.join(PEOPLE_DIR, file);
  const content = fs.readFileSync(filePath, 'utf8');
  const data = extractFrontMatter(content, file);
  if (!data || !data.family) continue;

  const groups = [
    ['parents', data.family.parents],
    ['spouses', data.family.spouses],
    ['children', data.family.children]
  ];

  for (const [groupName, entries] of groups) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry.url) continue; // already has a full page
      if (!looksLikeRealPerson(entry)) continue;
      findings.push({
        file,
        group: groupName,
        name: entry.name,
        indexed: isLikelyIndexed(entry.name)
      });
    }
  }
}

const missing = findings.filter(f => !f.indexed);
const maybeOk = findings.filter(f => f.indexed);

console.log(`\nScanned ${files.length} person pages.\n`);

if (missing.length) {
  console.log(`Likely NOT in people-index.json (${missing.length}) — verify each by hand:\n`);
  for (const f of missing) {
    console.log(`  [${f.file}] (${f.group}) ${f.name}`);
  }
} else {
  console.log('No obvious gaps found.');
}

if (maybeOk.length) {
  console.log(`\nAppear to already be indexed — worth a quick skim anyway (${maybeOk.length}):\n`);
  for (const f of maybeOk) {
    console.log(`  [${f.file}] (${f.group}) ${f.name}`);
  }
}

console.log('\nReminder: fuzzy matching only, not exact. And this script has no concept of the officiant/witness/physician exclusion rule — it only looks inside family blocks, so that shouldn\'t come up, but keep it in mind if you ever extend this to scan narrative prose too.\n');