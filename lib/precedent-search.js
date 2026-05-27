const { precedentsData, normalizeHs } = require('./data');

let flatIndex = null;

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

function tokenize(text) {
  return normalizeText(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);
}

function loadFlatPrecedents() {
  if (flatIndex) return flatIndex;
  flatIndex = [];
  for (const [finalHsCode, list] of Object.entries(precedentsData)) {
    const items = Array.isArray(list) ? list : [];
    for (const p of items) {
      flatIndex.push({
        precedentId: `tb-${String(p.tbTchqNumber || 'unknown').replace(/\//g, '-')}`,
        source: 'TB-TCHQ',
        tbTchqNumber: p.tbTchqNumber,
        productNameRaw: p.productName,
        technicalSpec: p.technicalSpec,
        finalHsCode: normalizeHs(finalHsCode),
        outcome: p.outcome && /^\d{8}$/.test(String(p.outcome)) ? 'APPROVED' : String(p.outcome || 'APPROVED'),
        year: p.year,
        sourceFile: p.sourceFile,
      });
    }
  }
  return flatIndex;
}

function scorePrecedent(description, precedent) {
  const descTokens = new Set(tokenize(description));
  const hay = tokenize(
    [precedent.productNameRaw, precedent.technicalSpec, precedent.tbTchqNumber].filter(Boolean).join(' '),
  );
  let hits = 0;
  for (const t of hay) {
    if (descTokens.has(t)) hits += 1;
  }
  const similarity = hay.length ? Math.min(0.99, hits / Math.max(3, descTokens.size)) : 0;
  return similarity;
}

function detectSet(description) {
  return /\b(bo|set|combo|kit|dong bo|goi)\b/i.test(normalizeText(description));
}

function searchPrecedents(description, { topK = 5 } = {}) {
  const desc = String(description || '').trim();
  if (desc.length < 3) return [];

  const scored = loadFlatPrecedents()
    .map((precedent) => ({
      precedent,
      similarity: scorePrecedent(desc, precedent),
      finalHsCode: precedent.finalHsCode,
      outcome: precedent.outcome,
    }))
    .filter((x) => x.similarity >= 0.15)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  return scored;
}

function applyPrecedentBoost(suggestions, description) {
  const matches = searchPrecedents(description, { topK: 3 });
  const approved = matches.find((m) => m.outcome === 'APPROVED' && m.similarity >= 0.25);
  if (!approved) {
    return { suggestions, precedentMatches: matches, girPrecedentRule: null };
  }

  const boosted = suggestions.map((s) => {
    if (normalizeHs(s.hsCode) !== approved.finalHsCode) return s;
    return {
      ...s,
      confidence: (Number(s.confidence) || 0) + Math.round(approved.similarity * 12),
      precedentReasoning: `Tương tự ${approved.precedent.tbTchqNumber} (${Math.round(approved.similarity * 100)}%)`,
    };
  });
  boosted.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

  return {
    suggestions: boosted,
    precedentMatches: matches,
    girPrecedentRule: 'GIR-4',
  };
}

module.exports = {
  searchPrecedents,
  detectSet,
  applyPrecedentBoost,
  loadFlatPrecedents,
};
