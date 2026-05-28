#!/usr/bin/env node
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildChaptersIndex } = require('../lib/chapters-index.js');

const chapters = buildChaptersIndex();
if (chapters.length < 90) {
  console.error('FAIL expected >=90 chapters, got', chapters.length);
  process.exit(1);
}
const ch85 = chapters.find((c) => c.chapter === '85');
if (!ch85 || ch85.hsCount < 10) {
  console.error('FAIL chapter 85', ch85);
  process.exit(1);
}
console.log('PASS chapters-index', chapters.length, 'chapters');
