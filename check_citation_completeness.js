#!/usr/bin/env node
/**
 * check_citation_completeness.js
 *
 * Audits Field Notes person pages for entries that still use plain
 * `source:` prose instead of proper `source_key` / `source_keys` wiring
 * (or an explicit `inline_cited: true`).
 *
 * Checks these arrays in front matter:
 *   - vitals[]
 *   - family.parents[]
 *   - family.spouses[]
 *   - family.children[]
 *   - marriages[]
 *   - timeline[]
 *
 * NOTE ON SCOPE: This script only checks structured YAML front-matter
 * fields, which is where person.njk's {% cite %} wiring operates. It
 * does NOT scan the prose body of Notes/Journal/Families pages, which
 * use inline [[cite:key]] tokens embedded in free-text content rather
 * than discrete fields — a different, fuzzier problem that would need
 * a separate pass (e.g. flagging paragraphs with factual claims but no
 * [[cite:...]] token nearby). Treat this as Phase 1: Ancestors pages.
 *
 * Usage:
 *   node check_citation_completeness.js
 *
 * Requires: js-yaml (already a project dependency)
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Directories to scan. Adjust if your Ancestors pages live elsewhere.
const SCAN_DIRS = [
  'src/people'
];

function stripBOM(content) {
  if (content.charCodeAt(0) === 0xFEFF) {
    return content.slice(1);
  }
  return content;
}

function extractFrontMatter(raw) {
  const normalized = raw.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  try {
    return yaml.load(match[1]);
  } catch (err) {
    return { __parseError: err.message };
  }
}

function isProperlyCited(entry) {
  if (!entry || typeof entry !== 'object') return true; // nothing to check
  if (entry.inline_cited) return true;
  if (entry.source_key || entry.source_keys) return true;
  return false;
}

function checkEntry(entry, fieldPath, findings, file) {
  if (!entry || typeof entry !== 'object') return;
  if (entry.source && !isProperlyCited(entry)) {
    findings.push({
      file,
      field: fieldPath,
      name: entry.name || entry.spouse || entry.event || '(unnamed)',
      source: entry.source
    });
  }
}

function auditFile(filePath) {
  const findings = [];
  const raw = stripBOM(fs.readFileSync(filePath, 'utf8'));
  const data = extractFrontMatter(raw);
  if (!data) return findings;
  if (data.__parseError) {
    findings.push({
      file: filePath,
      field: 'FRONTMATTER',
      name: '(YAML parse error — fix before this page can be audited)',
      source: data.__parseError
    });
    return findings;
  }

  (data.vitals || []).forEach((v, i) => checkEntry(v, `vitals[${i}]`, findings, filePath));

  if (data.family) {
    (data.family.parents || []).forEach((p, i) => checkEntry(p, `family.parents[${i}]`, findings, filePath));
    (data.family.spouses || []).forEach((s, i) => checkEntry(s, `family.spouses[${i}]`, findings, filePath));
    (data.family.children || []).forEach((c, i) => checkEntry(c, `family.children[${i}]`, findings, filePath));
  }

  (data.marriages || []).forEach((m, i) => checkEntry(m, `marriages[${i}]`, findings, filePath));
  (data.timeline || []).forEach((t, i) => checkEntry(t, `timeline[${i}]`, findings, filePath));

  return findings;
}

function walk(dir) {
  let results = [];
  if (!fs.existsSync(dir)) {
    console.warn(`Warning: directory not found, skipping: ${dir}`);
    return results;
  }
  const list = fs.readdirSync(dir);
  list.forEach(fileName => {
    const filePath = path.join(dir, fileName);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      results = results.concat(walk(filePath));
    } else if (fileName.endsWith('.njk') || fileName.endsWith('.md')) {
      results.push(filePath);
    }
  });
  return results;
}

function main() {
  let allFindings = [];
  let filesScanned = 0;

  SCAN_DIRS.forEach(dir => {
    const files = walk(dir);
    files.forEach(filePath => {
      filesScanned++;
      const findings = auditFile(filePath);
      allFindings = allFindings.concat(findings);
    });
  });

  console.log(`\nCitation Sweep Audit — Ancestors Pages`);
  console.log(`========================================`);
  console.log(`Files scanned: ${filesScanned}\n`);

  if (allFindings.length === 0) {
    console.log('No plain "source:" prose found in vitals/parents/spouses/children/marriages/timeline.');
    console.log('All checked entries use source_key, source_keys, or inline_cited.');
    return;
  }

  console.log(`Found ${allFindings.length} entries still using plain source: prose:\n`);

  const byFile = {};
  allFindings.forEach(f => {
    if (!byFile[f.file]) byFile[f.file] = [];
    byFile[f.file].push(f);
  });

  Object.keys(byFile).sort().forEach(file => {
    console.log(`\n${file}  (${byFile[file].length} entr${byFile[file].length === 1 ? 'y' : 'ies'})`);
    byFile[file].forEach(f => {
      console.log(`  - ${f.field}  [${f.name}]`);
      console.log(`      source: "${f.source}"`);
    });
  });

  fs.writeFileSync('citation_sweep_findings.json', JSON.stringify(allFindings, null, 2));
  console.log(`\n\nFull findings also written to citation_sweep_findings.json for reference.`);
}

main();