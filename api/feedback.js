const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { requireAuth } = require('../lib/auth');
const { setCors, handleOptions } = require('../lib/cors');
const {
  listFeedback,
  reviewFeedback,
  bulkReviewFeedback,
  detectRepeatedPatterns,
  exportCsv,
  FEEDBACK_PATH,
} = require('../lib/feedback-store');

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body && typeof body === 'object' ? body : null;
}

module.exports = function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (requireAuth(req, res)) return;

  if (req.method === 'GET') {
    const { status, feedbackType, hsPrefix, limit, offset, export: exportCsvFlag, patterns } =
      req.query;

    if (patterns === '1' || patterns === 'true') {
      return res.status(200).json({
        patterns: detectRepeatedPatterns(3),
      });
    }

    if (exportCsvFlag === '1' || exportCsvFlag === 'true') {
      const csv = exportCsv();
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="feedback-export.csv"');
      return res.status(200).send(csv);
    }

    const result = listFeedback({
      status: status || undefined,
      feedbackType: feedbackType || undefined,
      hsPrefix: hsPrefix || undefined,
      limit: Math.min(parseInt(limit, 10) || 50, 200),
      offset: parseInt(offset, 10) || 0,
    });
    return res.status(200).json({ ok: true, ...result });
  }

  if (req.method === 'PATCH') {
    const body = parseBody(req);
    if (Array.isArray(body?.feedbackIds) && body.feedbackIds.length) {
      const bulk = bulkReviewFeedback(body.feedbackIds, {
        action: body.action,
        reviewedBy: body.reviewedBy,
        rejectionReason: body.rejectionReason,
      });
      return res.status(200).json({ ok: true, ...bulk });
    }
    if (!body?.feedbackId) {
      return res.status(400).json({ error: 'feedbackId is required' });
    }
    try {
      const row = reviewFeedback(body.feedbackId, {
        action: body.action,
        reviewedBy: body.reviewedBy,
        rejectionReason: body.rejectionReason,
      });
      return res.status(200).json({ ok: true, feedback: row });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({ error: error.message });
      }
      if (error.code === 'VALIDATION') {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = parseBody(req);
  if (!body) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const feedbackType = String(body?.feedbackType || '').trim();
  if (!feedbackType) {
    return res.status(400).json({ error: 'feedbackType is required' });
  }

  const feedbackId = `fb_${crypto.randomBytes(8).toString('hex')}`;
  const record = {
    feedbackId,
    feedbackType,
    hsCodeAtTime: body?.hsCodeAtTime || null,
    correctedHsCode: body?.correctedHsCode || null,
    productName: body?.productName || null,
    directorNote: body?.directorNote || null,
    orderCode: body?.orderCode || null,
    status: 'pending',
    createdAt: body?.createdAt || new Date().toISOString(),
    receivedAt: new Date().toISOString(),
  };

  let persisted = false;
  try {
    fs.mkdirSync(path.dirname(FEEDBACK_PATH), { recursive: true });
    fs.appendFileSync(FEEDBACK_PATH, `${JSON.stringify(record)}\n`, 'utf8');
    persisted = true;
  } catch (error) {
    console.warn('feedback persist failed:', error.message);
  }

  return res.status(200).json({
    ok: true,
    feedbackId,
    persisted,
  });
};
