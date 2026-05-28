#!/usr/bin/env node
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const {
  listFeedback,
  reviewFeedback,
  bulkReviewFeedback,
  detectRepeatedPatterns,
  FEEDBACK_PATH,
} = require('../lib/feedback-store.js');

const promotionsPath = path.join(__dirname, '..', 'data', 'pattern-promotions.jsonl');

for (const p of [FEEDBACK_PATH, promotionsPath]) {
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

fs.mkdirSync(path.dirname(FEEDBACK_PATH), { recursive: true });
fs.appendFileSync(
  FEEDBACK_PATH,
  `${JSON.stringify({
    feedbackId: 'fb_test1',
    feedbackType: 'DIRECTOR_HS_OVERRIDE',
    hsCodeAtTime: '85171200',
    correctedHsCode: '85171300',
    productName: 'phone',
    status: 'pending',
    createdAt: '2026-05-01T00:00:00Z',
  })}\n`,
  'utf8',
);
fs.appendFileSync(
  FEEDBACK_PATH,
  `${JSON.stringify({
    feedbackId: 'fb_test2',
    feedbackType: 'DIRECTOR_HS_OVERRIDE',
    hsCodeAtTime: '85171200',
    correctedHsCode: '85171300',
    productName: 'phone2',
    status: 'pending',
    createdAt: '2026-05-02T00:00:00Z',
  })}\n`,
  'utf8',
);

const listed = listFeedback({ status: 'pending' });
if (listed.total !== 2) {
  console.error('FAIL list pending', listed.total);
  process.exit(1);
}

reviewFeedback('fb_test1', { action: 'approve', reviewedBy: 'test' });
const after = listFeedback({ status: 'approved' });
if (after.total !== 1) {
  console.error('FAIL approve count', after.total);
  process.exit(1);
}

if (!fs.existsSync(promotionsPath)) {
  console.error('FAIL pattern-promotions not written');
  process.exit(1);
}

const patterns = detectRepeatedPatterns(2);
if (!patterns.some((p) => p.fromHs === '85171200' && p.toHs === '85171300')) {
  console.error('FAIL pattern detection', patterns);
  process.exit(1);
}

const bulk = bulkReviewFeedback(['fb_test2'], { action: 'reject', reviewedBy: 'test' });
if (bulk.okCount !== 1) {
  console.error('FAIL bulk reject', bulk);
  process.exit(1);
}

console.log('PASS feedback-store');
