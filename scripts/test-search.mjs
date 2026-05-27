#!/usr/bin/env node
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(rootDir, 'package.json'));
const { searchCandidates } = require('./lib/search-utils');

const casesPath = join(rootDir, 'tests', 'search-cases.json');
const cases = JSON.parse(readFileSync(casesPath, 'utf8'));

let passed = 0;
let failed = 0;

for (const tc of cases) {
  const results = searchCandidates(tc.query, { topCandidates: 10 });
  const okCount = results.length >= (tc.minResults || 1);
  const topHs = results[0]?.hsCode || '';
  const okPrefix = !tc.topHsPrefix || topHs.startsWith(tc.topHsPrefix);
  const ok = okCount && okPrefix;

  if (ok) {
    passed += 1;
    console.log(`PASS ${tc.id}: "${tc.query}" -> ${results.length} (top ${topHs})`);
  } else {
    failed += 1;
    console.error(
      `FAIL ${tc.id}: "${tc.query}" -> ${results.length} results, top=${topHs || 'none'}` +
        (tc.topHsPrefix ? ` (expected prefix ${tc.topHsPrefix})` : '')
    );
  }
}

console.log(`\n${passed}/${cases.length} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
