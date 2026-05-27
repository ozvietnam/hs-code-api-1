const { requireAuth } = require('../lib/auth');
const { setCors, handleOptions } = require('../lib/cors');
const { diffSnapshotFiles, resolveVersionMeta } = require('../lib/tariff-versions');

/** Flat route avoids Vercel conflict: sibling `api/version.js` + `api/version/` breaks builds.
 * Canonical URL preserved via rewrite: `/api/version/diff` → this handler.
 */
module.exports = function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (requireAuth(req, res)) return;

  const fromQ = String(req.query.from || '').trim();
  const toQ = String(req.query.to || '').trim();
  if (!fromQ || !toQ) {
    return res.status(400).json({
      error: 'from and to parameters required (version id or snapshot file name)',
      example: '/api/version/diff?from=tax-a.json&to=tax-b.json',
    });
  }

  const limitRaw = parseInt(String(req.query.limit || '50'), 10);
  const detailLimit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 500);

  try {
    const fromMeta = resolveVersionMeta(fromQ);
    const toMeta = resolveVersionMeta(toQ);
    if (!fromMeta?.file) {
      return res.status(404).json({ error: 'from not found', from: fromQ });
    }
    if (!toMeta?.file) {
      return res.status(404).json({ error: 'to not found', to: toQ });
    }

    const diff = diffSnapshotFiles(fromMeta.file, toMeta.file, { detailLimit });
    return res.status(200).json({
      from: { id: fromMeta.id, file: fromMeta.file },
      to: { id: toMeta.id, file: toMeta.file },
      summary: diff.summary,
      details: diff.details,
    });
  } catch (e) {
    return res.status(400).json({ error: 'Diff failed', detail: e.message });
  }
};
