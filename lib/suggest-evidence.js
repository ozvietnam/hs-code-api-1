const {
  explanatoryNotesData,
  precedentsData,
  conflictsData,
  getChapterFromHs,
  normalizeHs,
} = require('./data');
const { getChapterRules, listAntiPatterns } = require('./compliance-data');

function noteForHs(hs) {
  const key = normalizeHs(hs);
  return explanatoryNotesData[key] || explanatoryNotesData[hs] || null;
}

function precedentsForHs(hs) {
  const key = normalizeHs(hs);
  const list = precedentsData[key] || precedentsData[hs] || [];
  return Array.isArray(list) ? list : [];
}

function conflictsForHs(hs) {
  const key = normalizeHs(hs);
  const list = conflictsData[key] || conflictsData[hs] || [];
  return Array.isArray(list) ? list : [];
}

function buildEvidenceTrace(description, candidates) {
  const chaptersTouched = new Set();
  const trace = [];

  for (const c of candidates.slice(0, 5)) {
    const hs = c.hsCode;
    const chapter = getChapterFromHs(hs);
    chaptersTouched.add(chapter);
    const note = noteForHs(hs);
    const precedents = precedentsForHs(hs).slice(0, 2);
    const conflicts = conflictsForHs(hs).slice(0, 2);

    trace.push({
      hsCode: hs,
      chapter,
      score: c.score,
      sources: [
        ...(note ? [{ type: 'explanatory_note', ref: note.section || note.id || hs }] : []),
        ...precedents.map((p) => ({ type: 'precedent', ref: p.id || p.title || hs })),
        ...conflicts.map((x) => ({ type: 'conflict', ref: x.id || x.summary || hs })),
        { type: 'tariff_index', ref: 'search.json' },
      ],
    });
  }

  const girRulesApplied = [];
  for (const ch of chaptersTouched) {
    const rules = getChapterRules(ch);
    if (rules) {
      girRulesApplied.push({
        chapter: ch,
        titleVi: rules.titleVi,
        hints: rules.girHints || [],
        requiredAttributes: rules.requiredAttributes || [],
      });
    }
  }

  const antiPatternHits = listAntiPatterns().filter((p) => {
    const ex = (p.example || '').toLowerCase();
    const desc = description.toLowerCase();
    if (ex && desc.includes(ex.split(' ')[0])) return true;
    if (p.id === 'marketing-only' && /\b(pro|max|plus|gb|inch)\b/i.test(desc)) return true;
    return false;
  });

  return {
    evidenceTrace: trace,
    girRulesApplied,
    antiPatternWarnings: antiPatternHits.map((p) => ({
      id: p.id,
      description: p.description,
      fix: p.fix,
    })),
  };
}

module.exports = { buildEvidenceTrace, noteForHs, precedentsForHs };
