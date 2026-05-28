const fs = require('fs');
const path = require('path');

const FEEDBACK_PATH = path.join(process.cwd(), 'data', 'feedback.jsonl');
const PROMOTIONS_PATH = path.join(process.cwd(), 'data', 'pattern-promotions.jsonl');

function readAll() {
  if (!fs.existsSync(FEEDBACK_PATH)) return [];
  const lines = fs.readFileSync(FEEDBACK_PATH, 'utf8').split('\n').filter(Boolean);
  const records = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (!row.status) row.status = 'pending';
      records.push(row);
    } catch {
      // skip malformed
    }
  }
  return records;
}

function writeAll(records) {
  fs.mkdirSync(path.dirname(FEEDBACK_PATH), { recursive: true });
  const body = records.map((r) => JSON.stringify(r)).join('\n');
  fs.writeFileSync(FEEDBACK_PATH, body ? `${body}\n` : '', 'utf8');
}

function listFeedback({ status, feedbackType, hsPrefix, limit = 50, offset = 0 } = {}) {
  let rows = readAll();
  if (status) rows = rows.filter((r) => r.status === status);
  if (feedbackType) rows = rows.filter((r) => r.feedbackType === feedbackType);
  if (hsPrefix) {
    const p = String(hsPrefix).replace(/\D/g, '').slice(0, 8);
    rows = rows.filter(
      (r) =>
        String(r.hsCodeAtTime || '').startsWith(p) ||
        String(r.correctedHsCode || '').startsWith(p),
    );
  }
  rows.sort((a, b) => String(b.receivedAt || b.createdAt).localeCompare(String(a.receivedAt || a.createdAt)));
  const total = rows.length;
  const items = rows.slice(offset, offset + limit);
  return { total, items, limit, offset };
}

function reviewFeedback(feedbackId, { action, reviewedBy, rejectionReason }) {
  const records = readAll();
  const idx = records.findIndex((r) => r.feedbackId === feedbackId);
  if (idx < 0) {
    const err = new Error('Feedback not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const row = records[idx];
  const now = new Date().toISOString();

  if (action === 'approve') {
    row.status = 'approved';
    row.reviewedBy = reviewedBy || 'admin';
    row.reviewedAt = now;
    if (row.correctedHsCode && row.correctedHsCode !== row.hsCodeAtTime) {
      appendPromotion({
        feedbackId,
        fromHs: row.hsCodeAtTime,
        toHs: row.correctedHsCode,
        productName: row.productName,
        approvedAt: now,
      });
    }
  } else if (action === 'reject') {
    row.status = 'rejected';
    row.reviewedBy = reviewedBy || 'admin';
    row.reviewedAt = now;
    row.rejectionReason = rejectionReason || null;
  } else {
    const err = new Error('action must be approve or reject');
    err.code = 'VALIDATION';
    throw err;
  }

  records[idx] = row;
  writeAll(records);
  return row;
}

function appendPromotion(entry) {
  try {
    fs.appendFileSync(PROMOTIONS_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // read-only FS
  }
}

function detectRepeatedPatterns(minCount = 3) {
  const records = readAll().filter((r) => r.status === 'pending' || r.status === 'approved');
  const overrides = {};

  for (const row of records) {
    if (!row.correctedHsCode || row.correctedHsCode === row.hsCodeAtTime) continue;
    const key = `${row.hsCodeAtTime}->${row.correctedHsCode}`;
    overrides[key] = (overrides[key] || 0) + 1;
  }

  return Object.entries(overrides)
    .filter(([, count]) => count >= minCount)
    .map(([pattern, count]) => {
      const [fromHs, toHs] = pattern.split('->');
      return { fromHs, toHs, count, pattern };
    })
    .sort((a, b) => b.count - a.count);
}

function bulkReviewFeedback(feedbackIds, options) {
  const ids = [...new Set((feedbackIds || []).map(String).filter(Boolean))];
  const results = [];
  for (const feedbackId of ids) {
    try {
      const feedback = reviewFeedback(feedbackId, options);
      results.push({ feedbackId, ok: true, feedback });
    } catch (error) {
      results.push({ feedbackId, ok: false, error: error.message });
    }
  }
  const okCount = results.filter((r) => r.ok).length;
  return { processed: results.length, okCount, results };
}

function exportCsv() {
  const { items } = listFeedback({ limit: 10000, offset: 0 });
  const header = [
    'feedbackId',
    'feedbackType',
    'status',
    'hsCodeAtTime',
    'correctedHsCode',
    'productName',
    'orderCode',
    'createdAt',
    'reviewedAt',
  ];
  const lines = [header.join(',')];
  for (const r of items) {
    lines.push(
      header
        .map((k) => {
          const v = r[k] == null ? '' : String(r[k]);
          return `"${v.replace(/"/g, '""')}"`;
        })
        .join(','),
    );
  }
  return lines.join('\n');
}

module.exports = {
  readAll,
  listFeedback,
  reviewFeedback,
  bulkReviewFeedback,
  detectRepeatedPatterns,
  exportCsv,
  FEEDBACK_PATH,
};
