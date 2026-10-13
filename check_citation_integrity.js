#!/usr/bin/env node
/**
 * check_citation_integrity.js
 *
 * Catches citation WIRING mistakes that Eleventy builds without complaint but
 * that show up on the live page: raw [[cite:...]] text, or a "Missing source
 * key" line in a page's References list.
 *
 * It only reports. It never changes a file.
 *
 * What it checks
 *   ERRORS (the page will look wrong; fix before pushing)
 *     1. MISSING_SOURCE  A source key is used somewhere in src/ but does not
 *                        exist in src/_data/sources.json. Looks at:
 *                          - source_key / source_keys anywhere in a page's front matter
 *                          - [[cite:key]] tokens anywhere in a page
 *                          - {% cite "key" %} / {% cite "key::detail", "key2" %} shortcodes
 *     2. RAW_TOKEN       (Ancestors pages) a note or description contains
 *                        [[cite:...]] but the entry is not marked
 *                        inline_cited: true, so the token prints as raw text.
 *     3. YAML_ERROR      A page's front matter cannot be parsed.
 *
 *   WARNINGS (harmless on the page, but probably not what you meant)
 *     4. KEYS_IGNORED       (Ancestors pages) inline_cited: true AND source_key(s)
 *                           on the same entry. person.njk skips the keys when an
 *                           entry is inline_cited, so they do nothing.
 *     5. INLINE_NO_TOKENS   (Ancestors pages) inline_cited: true but the note has
 *                           no [[cite:...]] token, so nothing is cited at all.
 *
 * What it does NOT check: plain-prose "source:" fields. That is
 * check_citation_completeness.js. Run both.
 *
 * Usage (from the project folder, same as the other check scripts):
 *   node check_citation_integrity.js
 *
 * Exit code is 1 when there is at least one ERROR, 0 otherwise.
 * Optional: node check_citation_integrity.js <path to project folder>
 *
 * Requires: js-yaml (already a project dependency)
 */

const fs = require('fs');
const path = require('path');

let yaml;
try {
  yaml = require('js-yaml');
} catch (e) {
  console.error('This script needs js-yaml. Run: npm install js-yaml --save-dev');
  process.exit(2);
}

const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : __dirname;
const SRC = path.join(ROOT, 'src');
const SOURCES_FILE = path.join(SRC, '_data', 'sources.json');

// Ancestors pages are the ones rendered by person.njk, where inline_cited matters.
const PEOPLE_DIR = path.join(SRC, 'people');
const SKIP_DIRS = new Set(['node_modules', 'images', '.git', '_site']);

// ---------- helpers ----------

function stripBOM(s) {
  return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
}

function frontMatter(raw) {
  const normalized = raw.replace(/\r\n/g, '\n');
  const m = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return { data: null };
  try {
    return { data: yaml.load(m[1]) || {} };
  } catch (err) {
    return { data: null, error: err.message.split('\n')[0] };
  }
}

// "key::optional detail" -> "key"
function keyOf(entry) {
  return String(entry).split('::')[0].trim();
}

function walk(dir) {
  let out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(name)) out = out.concat(walk(full));
    } else if (name.endsWith('.njk') || name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

// Every source key named in a page's front matter, at any depth.
function frontMatterKeys(node, found = []) {
  if (Array.isArray(node)) {
    node.forEach(n => frontMatterKeys(n, found));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'source_key' && typeof v === 'string') found.push(keyOf(v));
      else if (k === 'source_keys' && Array.isArray(v)) v.forEach(x => found.push(keyOf(x)));
      else frontMatterKeys(v, found);
    }
  }
  return found;
}

// Every key cited in the raw text of a page: [[cite:...]] tokens and {% cite "..." %} calls.
function textKeys(raw) {
  const found = [];
  const token = /\[\[cite:([^\]]+)\]\]/g;
  let m;
  while ((m = token.exec(raw)) !== null) found.push(keyOf(m[1]));

  const shortcode = /\{%-?\s*cite\s+([^%]*?)-?%\}/g; // does not match {% citeReferences %}
  while ((m = shortcode.exec(raw)) !== null) {
    const quoted = /"([^"]*)"|'([^']*)'/g;
    let q;
    while ((q = quoted.exec(m[1])) !== null) found.push(keyOf(q[1] !== undefined ? q[1] : q[2]));
  }
  return found;
}

// ---------- main ----------

if (!fs.existsSync(SOURCES_FILE)) {
  console.error(`Cannot find ${SOURCES_FILE}. Run this from the project folder.`);
  process.exit(2);
}
const sources = JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8'));

const findings = []; // { severity, code, file, where, message }
function add(severity, code, file, where, message) {
  findings.push({ severity, code, file: path.relative(ROOT, file).split(path.sep).join('/'), where, message });
}

const files = walk(SRC);
let pagesChecked = 0;
let peopleChecked = 0;

for (const file of files) {
  const raw = stripBOM(fs.readFileSync(file, 'utf8'));
  pagesChecked++;

  const fm = frontMatter(raw);
  if (fm.error) {
    add('ERROR', 'YAML_ERROR', file, 'front matter', fm.error);
    continue;
  }

  // 1. Missing source keys (front matter + text), de-duplicated per file
  const keys = new Set(textKeys(raw));
  if (fm.data) frontMatterKeys(fm.data).forEach(k => keys.add(k));
  for (const k of keys) {
    if (k && !Object.prototype.hasOwnProperty.call(sources, k)) {
      add('ERROR', 'MISSING_SOURCE', file, `"${k}"`, 'not in src/_data/sources.json');
    }
  }

  // 2-5. Structural checks, Ancestors pages only
  const isPerson = path.dirname(file) === PEOPLE_DIR && path.basename(file) !== 'index.njk';
  if (!isPerson || !fm.data) continue;
  peopleChecked++;

  const fam = fm.data.family || {};
  const sections = [
    ['vitals', fm.data.vitals],
    ['family.parents', fam.parents],
    ['family.spouses', fam.spouses],
    ['family.children', fam.children],
    ['marriages', fm.data.marriages],
    ['timeline', fm.data.timeline]
  ];

  for (const [name, list] of sections) {
    (list || []).forEach((e, i) => {
      if (!e || typeof e !== 'object') return;
      const text = typeof e.note === 'string' ? e.note : (typeof e.description === 'string' ? e.description : '');
      const hasToken = /\[\[cite:/.test(text);
      const inline = Boolean(e.inline_cited);
      const hasKeys = Boolean(e.source_key) || (Array.isArray(e.source_keys) && e.source_keys.length > 0);
      const label = e.name || e.spouse || e.event || e.date || '';
      const where = `${name}[${i}]${label ? ' ' + label : ''}`;

      if (hasToken && !inline) {
        add('ERROR', 'RAW_TOKEN', file, where,
          'note contains [[cite:...]] but inline_cited is not true, so the token prints as raw text');
      }
      if (inline && hasKeys) {
        add('WARNING', 'KEYS_IGNORED', file, where,
          'inline_cited is true, so its source_key(s) are skipped by person.njk');
      }
      if (inline && !hasToken) {
        add('WARNING', 'INLINE_NO_TOKENS', file, where,
          'inline_cited is true but the note has no [[cite:...]] token, so nothing is cited');
      }
    });
  }
}

// ---------- report ----------

const errors = findings.filter(f => f.severity === 'ERROR');
const warnings = findings.filter(f => f.severity === 'WARNING');

console.log('\nCitation Integrity Check');
console.log('========================');
console.log(`Pages scanned: ${pagesChecked} (${peopleChecked} Ancestors pages)`);
console.log(`Source keys in sources.json: ${Object.keys(sources).length}\n`);

function printGroup(title, list) {
  if (!list.length) return;
  console.log(`${title} (${list.length})`);
  console.log('-'.repeat(title.length + String(list.length).length + 3));
  const byFile = {};
  list.forEach(f => { (byFile[f.file] = byFile[f.file] || []).push(f); });
  Object.keys(byFile).sort().forEach(file => {
    console.log(`\n  ${file}`);
    byFile[file].forEach(f => {
      console.log(`    [${f.code}] ${f.where}`);
      console.log(`        ${f.message}`);
    });
  });
  console.log('');
}

printGroup('ERRORS', errors);
printGroup('WARNINGS', warnings);

if (!findings.length) {
  console.log('No problems found.');
} else {
  console.log(`Summary: ${errors.length} error(s), ${warnings.length} warning(s).`);
}
if (errors.length) {
  console.log('Fix the errors before pushing: they show on the live page.');
  process.exit(1);
}
