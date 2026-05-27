const brandProductMap = require('../data/brand-product-map.json');
const englishProductMap = require('../data/english-product-map.json');
const vnProductSynonyms = require('../data/vn-product-synonyms.json');

function removeDiacritics(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

const NOISE_TOKEN =
  /^(pro|max|plus|mini|ultra|lite|new|series|gen\d*|\d+(\.\d+)?(kg|g|l|ml|w|kw|v|ghz|mhz|gb|tb|m3|cm|mm|inch|in)?)$/i;

function stripNoiseTokens(tokens) {
  return tokens.filter((t) => t.length >= 2 && !NOISE_TOKEN.test(t));
}

function expandSearchQuery(raw) {
  const lower = String(raw || '').trim().toLowerCase();
  if (!lower) {
    return { original: raw, query: '', keywordTokens: [], expansionSources: [] };
  }

  const tokens = stripNoiseTokens(lower.split(/\s+/).filter(Boolean));
  const expansionTerms = new Set(tokens);
  const expansionSources = [];

  const vnKeys = Object.keys(vnProductSynonyms).sort((a, b) => b.length - a.length);
  for (const key of vnKeys) {
    const synonyms = vnProductSynonyms[key];
    if (!lower.includes(key) && !removeDiacritics(lower).includes(removeDiacritics(key))) continue;
    for (const syn of synonyms) {
      expansionTerms.add(syn);
      if (/^\d{4}$/.test(syn)) continue;
      syn.split(/\s+/).forEach((w) => {
        if (w.length >= 4) expansionTerms.add(w);
      });
    }
    expansionSources.push({ type: 'vn_synonym', term: key });
  }

  const englishKeys = Object.keys(englishProductMap).sort((a, b) => b.length - a.length);
  for (const key of englishKeys) {
    const vnTerms = englishProductMap[key];
    if (!vnTerms || !vnTerms.length) continue;
    if (!lower.includes(key)) continue;
    for (const vn of vnTerms) {
      expansionTerms.add(vn);
      vn.split(/\s+/).forEach((w) => {
        if (w.length >= 2) expansionTerms.add(w);
      });
    }
    expansionSources.push({ type: 'english', term: key });
  }

  for (const [brand, categories] of Object.entries(brandProductMap)) {
    const brandLower = brand.toLowerCase();
    const brandPlain = removeDiacritics(brandLower);
    const brandHit =
      lower.includes(brandLower) ||
      tokens.some((tok) => tok === brandLower || removeDiacritics(tok) === brandPlain);
    if (!brandHit) continue;
    for (const cat of categories) {
      expansionTerms.add(cat);
      cat.split(/\s+/).forEach((w) => {
        if (w.length >= 5) expansionTerms.add(w);
      });
    }
    expansionSources.push({ type: 'brand', term: brand });
  }

  const keywordTokens = [...expansionTerms]
    .flatMap((t) => stripNoiseTokens(t.split(/\s+/)))
    .filter((w, i, arr) => w.length >= 2 && arr.indexOf(w) === i);

  const expandedQuery = keywordTokens.join(' ');
  return {
    original: raw,
    query: expandedQuery || lower,
    keywordTokens: keywordTokens.length ? keywordTokens : tokens,
    expansionSources,
  };
}

module.exports = { expandSearchQuery, stripNoiseTokens, NOISE_TOKEN };
