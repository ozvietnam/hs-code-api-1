const { requireAuth } = require('../lib/auth');
const { setCors, handleOptions } = require('../lib/cors');
const { notesData, normalizeHs } = require('../lib/data');
const { buildNoteChain } = require('../lib/gir-notes');

module.exports = function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (requireAuth(req, res)) return;

  const { chapter, heading, hs, level } = req.query;
  const levelFilter = String(level || '').trim() || null;

  if (!chapter && !heading && !hs) {
    return res.status(400).json({
      error: 'chapter, heading, or hs parameter required',
      examples: [
        '/api/notes?chapter=85',
        '/api/notes?heading=8509',
        '/api/notes?hs=85171300',
        '/api/notes?hs=85171300&level=all',
      ],
      availableChapters: Object.keys(notesData).map(Number).sort((a, b) => a - b),
    });
  }

  const hsCode = hs ? normalizeHs(hs) : null;
  const chapterFromHs = hsCode ? String(parseInt(hsCode.slice(0, 2), 10)) : null;
  const chapNum = chapter
    ? String(parseInt(chapter, 10))
    : heading
      ? String(parseInt(String(heading || '').replace(/\./g, '').slice(0, 2), 10))
      : chapterFromHs;

  if (hsCode && (levelFilter === 'all' || levelFilter)) {
    const chain = buildNoteChain(hsCode, { levelFilter: levelFilter || 'all' });
    if (chain.length === 0) {
      return res.status(404).json({
        found: false,
        hsCode,
        message: `No GIR note chain for ${hsCode}`,
      });
    }
    return res.status(200).json({
      found: true,
      hsCode,
      level: levelFilter || 'all',
      chain,
      source: 'GIR 5-level chain (section → chapter → heading → subheading → national)',
    });
  }

  if (!notesData[chapNum]) {
    return res.status(404).json({
      found: false,
      message: `No notes for chapter ${chapNum}`,
    });
  }

  const chain = hsCode ? buildNoteChain(hsCode) : null;

  return res.status(200).json({
    found: true,
    chapter: parseInt(chapNum, 10),
    hsCode,
    content: notesData[chapNum],
    chain,
    source: 'Danh mục HHDM XNK Việt Nam - TT31/2022/TT-BTC',
  });
};
