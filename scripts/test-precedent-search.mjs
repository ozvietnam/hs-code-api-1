#!/usr/bin/env node
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { searchPrecedents } = require('../lib/precedent-search.js');

let passed = 0;
let failed = 0;

function assert(name, cond, detail) {
  if (cond) {
    console.log('PASS', name);
    passed += 1;
  } else {
    console.log('FAIL', name, detail || '');
    failed += 1;
  }
}

const matches = searchPrecedents('máy bơm Pentax', { topK: 5 });
assert('precedent search returns results', matches.length > 0);
assert('match has similarity', matches[0].similarity > 0);
assert('match has finalHsCode', /^\d{8}$/.test(matches[0].finalHsCode));

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
