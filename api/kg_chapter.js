const { requireAuth } = require('../lib/auth');
const { setCors, handleOptions } = require('../lib/cors');
const { taxData } = require('../lib/data');
const { buildChapterTree } = require('../lib/tree-metadata');

module.exports = function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (requireAuth(req, res)) return;

  const chapterRaw = req.query.chapter;
  if (!chapterRaw) {
    return res.status(400).json({
      error: 'chapter parameter required',
      example: '/api/kg_chapter?chapter=85',
    });
  }

  const chapter = String(parseInt(chapterRaw, 10)).padStart(2, '0');
  const treeMode = req.query.tree === '1' || req.query.tree === 'true';

  if (treeMode) {
    const payload = buildChapterTree(chapter);
    if (payload.total === 0) {
      return res.status(404).json({
        found: false,
        chapter,
        message: `No HS codes for chapter ${chapter}`,
      });
    }
    return res.status(200).json({ found: true, ...payload });
  }

  const items = Object.values(taxData)
    .filter((row) => row.hs.startsWith(chapter))
    .map((row) => ({
      hsCode: row.hs,
      nameVi: row.vn,
      unitVi: row.dvt || null,
      hasPolicyWarning: Boolean(row.cs && String(row.cs).trim()),
    }))
    .sort((a, b) => a.hsCode.localeCompare(b.hsCode));

  if (items.length === 0) {
    return res.status(404).json({
      found: false,
      chapter,
      message: `No HS codes for chapter ${chapter}`,
    });
  }

  return res.status(200).json({
    chapter,
    total: items.length,
    items,
  });
};
