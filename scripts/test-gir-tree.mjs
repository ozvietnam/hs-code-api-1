#!/usr/bin/env node
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getTreeMeta, buildChapterTree } = require('../lib/tree-metadata.js');

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

const meta = getTreeMeta('85171300');
assert('tree meta has indentation', typeof meta.indentationLevel === 'number');
assert('tree meta has siblings array', Array.isArray(meta.siblingHsCodes));

const tree = buildChapterTree('85');
assert('chapter tree built', tree.tree.length > 0);
assert('tree has national nodes', JSON.stringify(tree.tree).includes('8517'));

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
