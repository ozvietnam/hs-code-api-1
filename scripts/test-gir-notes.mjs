#!/usr/bin/env node
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildNoteChain, getNotesCoverage } = require('../lib/gir-notes.js');

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

const chain = buildNoteChain('85171300');
assert('chain has 5 levels', chain.length === 5);
assert('section XVI for ch85', chain[0].code === 'XVI');
assert('chapter 85', chain[1].code === '85');
assert('national includes bao_gom', chain[4].noteType === 'INCLUDES');

const cov = getNotesCoverage();
assert('coverage has national', cov.byNational > 8000);
assert('coverage pct computed', cov.pctOfTarget > 0);

console.log(`\n${passed}/${passed + failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
