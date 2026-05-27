#!/usr/bin/env node
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { appendAccess, summarizeTodayAccess } = require('../lib/access-log.js');

const logPath = path.join(__dirname, '..', 'data', 'access-log.jsonl');
if (fs.existsSync(logPath)) fs.unlinkSync(logPath);

appendAccess({ route: '/api/search', ms: 120, querySnippet: 'máy bơm', hsCode: '84137099' });
appendAccess({ route: '/api/match', ms: 95, querySnippet: 'ống nhựa', hsCode: '39173220' });

const s = summarizeTodayAccess();
if (s.requestsToday < 2) {
  console.error('FAIL expected >=2 requests today, got', s.requestsToday);
  process.exit(1);
}
console.log('PASS access log', s.requestsToday, 'requests, p90', s.latencyP90Ms);
