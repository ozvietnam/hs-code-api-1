const { taxData } = require('./data');

let cache;

function buildChaptersIndex() {
  if (cache) return cache;

  const byChapter = new Map();

  for (const row of Object.values(taxData)) {
    const chapter = row.hs.slice(0, 2);
    let entry = byChapter.get(chapter);
    if (!entry) {
      entry = {
        chapter,
        hsCount: 0,
        warningCount: 0,
        title: null,
      };
      byChapter.set(chapter, entry);
    }
    entry.hsCount += 1;
    if (row.cs && String(row.cs).trim()) entry.warningCount += 1;
    if (!entry.title && row.hs.length === 4 && row.hs.startsWith(chapter)) {
      entry.title = row.vn;
    }
  }

  cache = [...byChapter.values()]
    .map((e) => ({
      ...e,
      title: e.title || `Chương ${parseInt(e.chapter, 10)}`,
      hasWarnings: e.warningCount > 0,
    }))
    .sort((a, b) => a.chapter.localeCompare(b.chapter));

  return cache;
}

module.exports = { buildChaptersIndex };
